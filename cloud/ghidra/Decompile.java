// Decompila funções para C e escreve na saída (usado pelo ghidra-decompile, no modo headless).
// Argumentos: nomes ou endereços das funções (vazio = todas, até o limite).
//@category Studio
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import java.util.ArrayList;
import java.util.List;

public class Decompile extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        int limit = Integer.parseInt(System.getenv().getOrDefault("GHIDRA_LIMIT", "200"));
        DecompInterface d = new DecompInterface();
        d.openProgram(currentProgram);
        List<Function> funcs = new ArrayList<>();
        if (args.length == 0) {
            for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
                if (f.isThunk() || f.isExternal()) continue;
                funcs.add(f);
                if (funcs.size() >= limit) break;
            }
        } else {
            for (String a : args) {
                Function f = null;
                try {
                    Address ad = toAddr(a);
                    if (ad != null) f = getFunctionContaining(ad);
                } catch (Exception e) { /* não é endereço */ }
                if (f == null) {
                    for (Function g : currentProgram.getFunctionManager().getFunctions(true)) {
                        if (g.getName().equals(a)) { f = g; break; }
                    }
                }
                if (f == null) println("// não encontrada: " + a);
                else funcs.add(f);
            }
        }
        StringBuilder out = new StringBuilder();
        for (Function f : funcs) {
            if (monitor.isCancelled()) break;
            DecompileResults r = d.decompileFunction(f, 60, monitor);
            out.append("// ").append(f.getName()).append(" @ ").append(f.getEntryPoint()).append("\n");
            if (r != null && r.decompileCompleted()) out.append(r.getDecompiledFunction().getC()).append("\n");
            else out.append("// falhou: ").append(r == null ? "?" : r.getErrorMessage()).append("\n\n");
        }
        String path = System.getenv("GHIDRA_OUT");
        if (path != null && !path.isEmpty()) java.nio.file.Files.writeString(java.nio.file.Path.of(path), out.toString());
        else System.out.print(out);
    }
}
