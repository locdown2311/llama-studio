# Llama Studio na nuvem

O studio no celular e em qualquer navegador, com a sua conta:

- **PC ligado**: tudo roda no seu PC (modelo local, ferramentas, arquivos, Ghidra...). O PC abre uma conexão de saída para o servidor; não precisa abrir porta no roteador.
- **PC desligado**: a conta continua na nuvem, com as conversas sincronizadas e uma pasta própria, só com as APIs (cada usuário usa as próprias chaves).
- **App**: abra o endereço no celular e escolha "Adicionar à tela inicial" (Android e iPhone).

```
celular/navegador ──HTTPS──► Caddy ──► studio-hub ──┬─► túnel ──► studio do seu PC
                                                    └─► contêiner do usuário (studio sem llama.cpp)
                                                          └─ internet só pelo proxy do hub
```

## O que cada usuário recebe na nuvem

- Um contêiner só dele: pasta em `HUB_DATA/users/<id>`, sistema só de leitura, sem privilégios, com limite de RAM, CPU, processos e disco.
- O contêiner liga no primeiro acesso e desliga depois de `HUB_IDLE_MIN` minutos parado.
- Sem rede direta. A saída passa pelo proxy do hub: só HTTPS (portas 443 e 80) para endereços públicos, nunca a rede local, o Docker, o próprio servidor ou o endereço de metadados da nuvem. Com `HUB_ALLOW`, só os domínios que você listar.

## Instalar (servidor ARM64 ou x86_64, com Docker)

1. Aponte o DNS do domínio para o servidor e libere as portas 80 e 443.
2. Copie a pasta `cloud/` para o servidor e crie o `.env`:
   ```sh
   cp .env.example .env    # edite DOMAIN e o resto
   sudo mkdir -p /srv/studio-hub
   ```
3. Suba:
   ```sh
   docker compose pull
   docker compose up -d
   ```
   As imagens prontas (`ghcr.io/locdown2311/studio-hub` e `llama-studio-cloud`) têm ARM64 e x86_64. O hub baixa a do studio sozinho no primeiro uso e confere se há versão nova a cada 6 h. Cada studio troca de versão quando desliga; as pastas continuam.
4. Abra `https://SEU_DOMINIO`, crie a sua conta e, se quiser fechar o cadastro depois, ponha `HUB_SIGNUP=closed` no `.env` e rode `docker compose up -d`.

### Compilar no próprio servidor (em vez de baixar)

Rode na raiz do repositório:

```sh
docker build -f cloud/Dockerfile.studio -t llama-studio-cloud:local .
docker build -f cloud/Dockerfile.hub -t studio-hub:local .
```

Depois, no `.env`, ponha `HUB_IMAGE=llama-studio-cloud:local` e `HUB_HUB_IMAGE=studio-hub:local`.

## Ligar o PC

No studio do PC, vá em **Configurações → Nuvem** e preencha o endereço, o e-mail e a senha da conta. O PC recebe um token próprio e a senha não fica guardada.

- **Receber o chat de outros aparelhos** liga e desliga o acesso remoto. Ligado, quem entra na conta usa o PC por inteiro.
- As conversas, os projetos e as personalidades sincronizam a cada 30 s enquanto o PC está conectado.

No celular, uma etiqueta no topo mostra onde o studio está rodando (**PC** ou **Nuvem**). Se o PC conecta ou cai, aparece um aviso para trocar.

## Administrar

Os comandos rodam dentro do contêiner do hub:

```sh
docker compose exec hub studio-hub users              # lista as contas
docker compose exec hub studio-hub disable a@b.com    # bloqueia (e derruba as sessões)
docker compose exec hub studio-hub enable a@b.com
docker ps --filter label=studio-hub=1                 # studios ligados agora
```

## Segurança

- Senhas com argon2. Sessão em cookie `HttpOnly`/`Secure`. Tokens de PC e sessões são guardados só como hash.
- Proteção contra força bruta: 10 tentativas erradas por IP ou por conta seguram o login por 15 minutos.
- Pedidos que mudam algo exigem o cabeçalho `x-hub`, que um site de fora não consegue enviar.
- O hub controla o Docker (usa o socket), então trate o servidor como de confiança. O PC confia no hub: quem entra na sua conta usa o seu PC, por isso use uma senha forte e desligue o acesso remoto quando não precisar.
- Cadastro aberto atrai abuso. Os limites ajudam (contêiner isolado, proxy só para endereços públicos, máximo de cadastros por IP por dia, máximo de studios ligados), mas acompanhe o uso pelo `docker stats`.

## Limitações conhecidas

- Na nuvem não há modelo local, navegador do studio nem controle do computador. Executar binários x86 num servidor ARM precisa de emulação, então a análise estática funciona e a dinâmica fica para o PC.
- Projetos ligados a pastas do PC aparecem na nuvem, mas a pasta não existe lá. Use projetos da pasta da nuvem quando o PC estiver desligado.
- Se a mesma conversa for editada nos dois lados antes de sincronizar, vale a versão mais recente.
