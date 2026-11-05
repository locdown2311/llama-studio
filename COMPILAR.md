# llama studio (Rust): como compilar

No Windows, com o Rust instalado (https://rustup.rs):

    cargo build --release

Copie `target\release\llama-studio.exe` para `llama\llama-studio\`. No toolchain GNU
o `WebView2Loader.dll` precisa ficar ao lado do .exe; no MSVC ele vai embutido.

- `ui/` é a interface (HTML/CSS/JS) e vai embutida no executável.
- `--no-default-features` gera uma versão sem janela própria (abre no navegador).

Opções do executável:
- `--navegador`         usa o navegador em vez da janela própria
- `--bandeja`           começa só com o ícone na bandeja
- `--iniciar-servidor`  inicia o llama-server ao abrir (se já estiver aberto, só pede para iniciar)

Pastas:
- `llama-studio\dados\`      configuração, conectores (mcp.json), habilidades, perfil do navegador
- `llama-studio\llama-path\` página que o llama-server mostra na porta dele (leva ao studio)
- A configuração do servidor fica em `llama\llama-gui.json` (a mesma do llama-gui).
