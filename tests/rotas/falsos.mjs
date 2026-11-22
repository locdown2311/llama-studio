// frases do dia a dia que o roteador não pode confundir (falsos positivos que apareceram no uso real)
export const mcps = ['x64dbg', 'x32dbg', 'ghidra'].map((name) => ({ name }));
export default [
  // [frase, perfis esperados]
  ['crie um jogo de sinuca com física', []],
  ['meu processo travou no Windows', []],
  ['a memória do computador está cheia', []],
  ['organize os arquivos por data', ['files']],
  ['renomeie as fotos da pasta', ['files']],
  ['não use o navegador para isso', []],
  ['como funciona o x64dbg?', ['re']],
  ['quero entender como o serial é validado nesse executável', ['re']],
  ['me lista as strings desse executável', ['re']],
];
