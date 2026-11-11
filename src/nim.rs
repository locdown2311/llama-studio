//! Limite de pedidos das APIs externas. Começou pelo NVIDIA NIM (40 pedidos por minuto na conta, plano grátis)
//! e vale para qualquer API com limite configurado (pedidos por minuto e/ou por dia). Em vez de deixar o pedido
//! bater no 429, o studio segura a fila aqui: cada pedido pega uma vaga numa janela móvel de 60 s e, sem vaga,
//! espera a mais antiga sair. A conversa tem vagas reservadas (exploradores e tarefas de fundo param antes),
//! e um 429 que mesmo assim venha fecha a porta pelo tempo do Retry-After. O limite diário recusa na hora
//! (esperar horas não adianta): a interface cai em outra API ou no modelo local.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// O limite do NIM.
pub const MAX: usize = 40;
/// O que o studio usa do NIM: 2 de folga para diferença de relógio com o servidor deles.
pub const BUDGET: usize = 38;
/// Vagas do NIM que só a conversa usa (exploradores, auditor e tarefas de fundo param em BUDGET - RESERVE).
pub const RESERVE: usize = 10;

/// Quanto o studio usa de um limite por minuto (folga de 5%, no mínimo 1 a partir de 10).
pub fn budget_of(max: usize) -> usize {
    if max >= 10 { max - (max / 20).max(1) } else { max.max(1) }
}
/// Vagas reservadas para a conversa: um quarto do que o studio usa (nenhuma com limites muito baixos).
pub fn reserve_of(budget: usize) -> usize {
    if budget >= 4 { budget.div_ceil(4) } else { 0 }
}
pub const WINDOW: Duration = Duration::from_secs(60);
/// A reserva só vale enquanto alguma conversa usou o NIM há pouco.
const MAIN_RECENT: Duration = Duration::from_secs(300);
/// Mais que isso na fila e o pedido volta como 429 (a interface cai no modelo local ou avisa).
pub const MAX_WAIT: Duration = Duration::from_secs(75);

struct State {
    hits: Vec<Instant>,
    blocked_until: Option<Instant>,
    last_main: Option<Instant>,
    /// limite por minuto (0 = sem) e o que o studio usa dele
    budget: usize,
    reserve: usize,
}

impl Default for State {
    fn default() -> Self {
        State { hits: vec![], blocked_until: None, last_main: None, budget: BUDGET, reserve: RESERVE }
    }
}

#[derive(Default)]
pub struct Nim {
    st: Mutex<State>,
    waiting: AtomicU32,
}

pub struct Status {
    pub used: u32,
    pub wait_secs: u32,
    pub waiting: u32,
    /// vagas para a conversa agora
    pub free: u32,
    /// segundos até a próxima vaga abrir (0 = há vaga)
    pub next_secs: u32,
}

impl State {
    fn prune(&mut self, now: Instant) {
        self.hits.retain(|t| now.saturating_duration_since(*t) < WINDOW);
        if self.blocked_until.is_some_and(|b| b <= now) {
            self.blocked_until = None;
        }
    }
    fn cap(&self, side: bool, now: Instant) -> usize {
        if self.budget == 0 {
            return usize::MAX; // só limite diário
        }
        let main_active = self.last_main.is_some_and(|t| now.saturating_duration_since(t) < MAIN_RECENT);
        if side && main_active { self.budget - self.reserve } else { self.budget }
    }
    /// Quanto falta para haver vaga abaixo de `cap` (zero = há vaga agora).
    fn wait_for(&self, cap: usize, now: Instant) -> Duration {
        let block = self.blocked_until.map(|b| b.saturating_duration_since(now)).unwrap_or_default();
        let full = if cap > 0 && self.hits.len() >= cap {
            // precisa sair o (len - cap + 1)-ésimo mais antigo
            let t = self.hits[self.hits.len() - cap];
            WINDOW.saturating_sub(now.saturating_duration_since(t))
        } else {
            Duration::ZERO
        };
        block.max(full)
    }
    /// Pega uma vaga, ou diz quanto esperar.
    fn try_take(&mut self, side: bool, now: Instant) -> Result<(), Duration> {
        self.prune(now);
        let wait = self.wait_for(self.cap(side, now), now);
        if !wait.is_zero() {
            return Err(wait);
        }
        self.hits.push(now);
        if !side {
            self.last_main = Some(now);
        }
        Ok(())
    }
}

struct Waiting<'a>(&'a AtomicU32);
impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

impl Nim {
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.st.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Fila com outro limite por minuto (0 = sem limite por minuto).
    pub fn with_rpm(rpm: usize) -> Self {
        let n = Nim::default();
        n.set_rpm(rpm);
        n
    }

    /// Muda o limite (a pessoa editou a API); os pedidos da janela continuam contando.
    pub fn set_rpm(&self, rpm: usize) {
        let mut s = self.lock();
        let b = if rpm == 0 { 0 } else { budget_of(rpm) };
        s.budget = b;
        s.reserve = reserve_of(b);
    }

    /// Espera uma vaga (no máximo MAX_WAIT). Err = segundos que ainda faltariam.
    /// `side`: pedido que não é a conversa (explorador, auditor, resumo, tarefa de fundo).
    pub async fn acquire(&self, side: bool) -> Result<(), u64> {
        let t0 = Instant::now();
        let mut guard = None;
        loop {
            let wait = match self.lock().try_take(side, Instant::now()) {
                Ok(()) => return Ok(()),
                Err(w) => w,
            };
            if t0.elapsed() + wait > MAX_WAIT {
                return Err(wait.as_secs().max(1));
            }
            if guard.is_none() {
                self.waiting.fetch_add(1, Ordering::Relaxed);
                guard = Some(Waiting(&self.waiting));
            }
            // um pouco além, para não acordar antes da vaga abrir
            tokio::time::sleep(wait + Duration::from_millis(60)).await;
        }
    }

    /// O NIM respondeu 429 mesmo assim (outro programa na mesma chave, relógio): ninguém pede por `secs`.
    pub fn block(&self, secs: u64) {
        let until = Instant::now() + Duration::from_secs(secs.clamp(2, 60));
        let mut s = self.lock();
        if s.blocked_until.is_none_or(|b| b < until) {
            s.blocked_until = Some(until);
        }
    }

    pub fn status(&self) -> Status {
        let now = Instant::now();
        let mut s = self.lock();
        s.prune(now);
        let used = s.hits.len();
        let budget = s.budget;
        let wait = s.wait_for(if budget == 0 { usize::MAX } else { budget }, now);
        let ceil = |d: Duration| if d.is_zero() { 0 } else { d.as_secs() as u32 + 1 };
        let next = s.hits.first().map(|t| WINDOW.saturating_sub(now.saturating_duration_since(*t))).unwrap_or_default();
        Status {
            used: used as u32,
            wait_secs: ceil(wait),
            waiting: self.waiting.load(Ordering::Relaxed),
            free: if wait.is_zero() { budget.saturating_sub(used) as u32 } else { 0 },
            next_secs: if used == 0 { 0 } else { ceil(next) },
        }
    }
}

#[cfg(test)]
mod t {
    use super::*;

    #[test]
    fn folgas_dos_limites() {
        assert_eq!((budget_of(40), reserve_of(budget_of(40))), (BUDGET, RESERVE));
        assert_eq!(budget_of(20), 19);
        assert_eq!(budget_of(5), 5);
        assert_eq!(reserve_of(3), 0);
        let n = Nim::with_rpm(5);
        let mut s = n.lock();
        let t0 = Instant::now();
        for i in 0..5 {
            assert!(s.try_take(false, t0 + Duration::from_millis(i)).is_ok());
        }
        assert!(s.try_take(false, t0 + Duration::from_secs(1)).is_err());
    }

    #[test]
    fn sem_limite_por_minuto_nao_espera() {
        let n = Nim::with_rpm(0);
        let mut s = n.lock();
        let t0 = Instant::now();
        for i in 0..500 {
            assert!(s.try_take(true, t0 + Duration::from_millis(i)).is_ok());
        }
    }

    #[test]
    fn conversa_usa_o_orcamento_inteiro() {
        let mut s = State::default();
        let t0 = Instant::now();
        for i in 0..BUDGET {
            assert!(s.try_take(false, t0 + Duration::from_millis(i as u64)).is_ok(), "pedido {i}");
        }
        let w = s.try_take(false, t0 + Duration::from_secs(1)).unwrap_err();
        assert!(w > Duration::from_secs(58) && w <= WINDOW, "{w:?}");
        // a mais antiga saiu da janela: abre uma vaga
        assert!(s.try_take(false, t0 + Duration::from_secs(61)).is_ok());
    }

    #[test]
    fn lateral_para_antes_e_deixa_vaga_para_a_conversa() {
        let mut s = State::default();
        let t0 = Instant::now();
        assert!(s.try_take(false, t0).is_ok()); // a conversa está no NIM
        for i in 1..(BUDGET - RESERVE) {
            assert!(s.try_take(true, t0 + Duration::from_millis(i as u64)).is_ok(), "lateral {i}");
        }
        assert!(s.try_take(true, t0 + Duration::from_secs(1)).is_err(), "lateral passou da parte dela");
        for i in 0..RESERVE {
            assert!(s.try_take(false, t0 + Duration::from_secs(2) + Duration::from_millis(i as u64)).is_ok(), "conversa {i}");
        }
        assert!(s.try_take(false, t0 + Duration::from_secs(3)).is_err());
    }

    #[test]
    fn sem_conversa_no_nim_a_lateral_usa_tudo() {
        let mut s = State::default();
        let t0 = Instant::now();
        for i in 0..BUDGET {
            assert!(s.try_take(true, t0 + Duration::from_millis(i as u64)).is_ok(), "lateral {i}");
        }
        assert!(s.try_take(true, t0 + Duration::from_secs(1)).is_err());
    }

    #[test]
    fn espera_so_ate_ter_vaga() {
        // 38 pedidos espalhados, um por segundo: no limite, a espera é até o primeiro sair, não a janela toda
        let mut s = State::default();
        let t0 = Instant::now();
        for i in 0..BUDGET {
            s.try_take(false, t0 + Duration::from_secs(i as u64)).unwrap();
        }
        let w = s.try_take(false, t0 + Duration::from_secs(40)).unwrap_err();
        assert_eq!(w, Duration::from_secs(20));
    }

    #[test]
    fn bloqueio_do_429_segura_todo_mundo() {
        let mut s = State::default();
        let t0 = Instant::now();
        s.blocked_until = Some(t0 + Duration::from_secs(10));
        assert_eq!(s.try_take(false, t0).unwrap_err(), Duration::from_secs(10));
        assert!(s.try_take(false, t0 + Duration::from_secs(11)).is_ok());
    }
}
