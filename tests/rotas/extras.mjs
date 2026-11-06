// validação final: frases novas, perfis + conectores + habilidades
export const skills = [
  { id: 'instagram-posts', name: 'instagram-posts', description: 'Cria legendas e roteiros para posts do Instagram com hashtags e chamada para ação.' },
  { id: 'x64dbg-re', name: 'x64dbg-re', description: 'Fluxo de engenharia reversa com x64dbg: strings, breakpoints, renomear funções e registrar achados.' },
  { id: 'pdf', name: 'pdf', description: 'Ler, juntar, dividir e extrair páginas e tabelas de arquivos PDF.' },
  { id: 'rust-dev', name: 'rust-dev', description: 'Boas práticas de Rust, cargo, testes e tratamento de erros.' },
  { id: 'relatorio-semanal', name: 'relatorio-semanal', description: 'Monta o relatório semanal da equipe a partir das tarefas concluídas.' },
];
export const mcps = ['x64dbg', 'x32dbg', 'meshy', 'unityMCP', 'google-drive', 'filesystem', 'memory', 'github'].map((name) => ({ name }));
export default [
  // [frase, perfis, conectores pelo nome, habilidades]
  ['pausa o x32dbg no OEP e me mostra os registradores', ['re'], ['x32dbg'], ['x64dbg-re']],
  ['gera um modelo 3d de uma espada no meshy', [], ['meshy'], []],
  ['importa o modelo no unity e coloca na cena', [], ['unityMCP'], []],
  ['salva esse relatório no google drive', [], ['google-drive'], []],
  ['procura no google o significado de "drive"', ['web'], [], []],
  ['abre uma issue no github sobre o bug do login', ['code'], ['github'], []],
  ['minha memória tá fraca hoje', [], [], []],
  ['monta o relatório semanal com o que fechamos', [], [], ['relatorio-semanal']],
  ['faz uma legenda pro instagram da padaria', ['social'], [], ['instagram-posts']],
  ['junta esses dois pdfs e tira a página 3', ['files'], [], ['pdf']],
  ['o cargo clippy reclamou de um unwrap, corrige', ['code'], [], []], // aceito: não acha a habilidade de Rust
  ['posts do linkedin sobre carreira', [], [], []],
  ['o que é rust?', [], [], []],
  ['me explica o que é um pdf', [], [], []],
  ['escreve um post de aniversário pro instagram da minha irmã', ['social'], [], ['instagram-posts']],
  ['anexa o x64dbg no chrome.exe e lista os módulos', ['re'], ['x64dbg'], ['x64dbg-re']],
  ['qual o tamanho da pasta Downloads?', ['files'], [], []],
  ['manda um resumo da reunião por email', [], [], []],
  ['quero aprender inglês sozinho, por onde começo?', [], [], []],
  ['cria um script em python que baixa os pdfs de um site', ['code', 'web'], [], ['pdf']],
  ['o filesystem tá cheio, limpa os temporários', [], ['filesystem'], []],
  ['qual a melhor estratégia de engajamento no instagram?', ['social'], [], ['instagram-posts']],
  ['escreve um roteiro de vídeo pro youtube sobre café', [], [], []],
  ['tem algum vírus nesse arquivo setup.exe?', ['re'], [], ['x64dbg-re']],
];
