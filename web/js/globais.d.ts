// Tipos do que o tema.js (script clássico, carregado antes dos módulos) publica em window.
interface Window {
  temaTC: {
    preferencia(): "escuro" | "claro" | "sistema";
    definir(escolha: "escuro" | "claro" | "sistema"): void;
  };
}
