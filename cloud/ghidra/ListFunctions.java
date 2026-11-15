// Lista as funções (endereço, tamanho, nome) e as importações. Usado pelo ghidra-decompile --list.
//@category Studio
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Symbol;

public class ListFunctions extends GhidraScript {
    @Override
    public void run() throws Exception {
        StringBuilder out = new StringBuilder("# funções\n");
        for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
            if (f.isExternal()) continue;
            out.append(f.getEntryPoint()).append('\t').append(f.getBody().getNumAddresses()).append('\t').append(f.getName()).append('\n');
        }
        out.append("# importações\n");
        for (Symbol s : currentProgram.getSymbolTable().getExternalSymbols()) out.append(s.getParentNamespace().getName()).append('!').append(s.getName()).append('\n');
        String path = System.getenv("GHIDRA_OUT");
        if (path != null && !path.isEmpty()) java.nio.file.Files.writeString(java.nio.file.Path.of(path), out.toString());
        else System.out.print(out);
    }
}
