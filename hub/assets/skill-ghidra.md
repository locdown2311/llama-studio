---
name: ghidra
description: Descompilar e analisar binários (PE, ELF, Mach-O, firmware) com o Ghidra sem janela, na pasta da nuvem.
triggers: descompilar, decompilar, ghidra, engenharia reversa, disassembly, binário, .exe, .dll, .so, função
---
# Ghidra na nuvem

O Ghidra está instalado em `/opt/ghidra` e roda sem janela pelo comando `ghidra-decompile`:

- `ghidra-decompile --list arquivo.exe` lista as funções (endereço, tamanho, nome) e as importações.
- `ghidra-decompile arquivo.exe main 0x401000` decompila só essas funções, por nome ou por endereço.
- `ghidra-decompile arquivo.exe` decompila tudo, até 200 funções (`GHIDRA_LIMIT` muda o limite).

A primeira chamada num binário faz a análise completa, que leva de segundos a minutos. As seguintes reaproveitam a análise guardada em `~/ghidra-projetos`.

Como trabalhar:

1. Comece com `file` e `--list` para ver a arquitetura, as importações e os nomes interessantes, como as funções de licença, criptografia e rede.
2. Decompile poucas funções por vez e siga as chamadas.
3. Confira as strings com `strings -n 6 arquivo | rg -i palavra` e os bytes com `objdump -d --start-address=...`.
4. Para PE e ELF em Python, use `pefile`, `lief`, `capstone` e `pyelftools`, que já estão instalados.

Limites da nuvem:

- Não dá para executar nem depurar o binário (servidor ARM, sem Wine). Análise dinâmica é no PC.
- Pouca memória: com binários grandes, use `GHIDRA_MAXMEM=1500M` se o plano permitir. Se a análise morrer por falta de memória, analise só uma parte.
