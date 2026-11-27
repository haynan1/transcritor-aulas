// Carregado no <head>, antes de pintar: evita o clarão do tema errado ao abrir.
(function () {
  var CHAVE = "tc-tema";
  var sistema = window.matchMedia("(prefers-color-scheme: light)");

  function preferencia() {
    try {
      var valor = localStorage.getItem(CHAVE);
      return valor === "claro" || valor === "escuro" ? valor : "sistema";
    } catch (erro) {
      return "sistema";
    }
  }

  function aplicar(escolha) {
    var efetivo = escolha === "sistema" ? (sistema.matches ? "claro" : "escuro") : escolha;
    document.documentElement.dataset.tema = efetivo;
    document.documentElement.dataset.preferenciaTema = escolha;
  }

  window.temaTC = {
    preferencia: preferencia,
    definir: function (escolha) {
      try {
        if (escolha === "sistema") localStorage.removeItem(CHAVE);
        else localStorage.setItem(CHAVE, escolha);
      } catch (erro) {
        /* sem armazenamento: vale só nesta aba */
      }
      aplicar(escolha);
      document.dispatchEvent(new CustomEvent("tema"));
    },
  };

  // A barra lateral recolhida também precisa valer antes de pintar, para não pular.
  try {
    if (localStorage.getItem("tc-lateral") === "recolhida") document.documentElement.dataset.lateral = "recolhida";
  } catch (erro) {
    /* sem armazenamento: começa aberta */
  }

  sistema.addEventListener("change", function () {
    if (document.documentElement.dataset.preferenciaTema === "sistema") {
      aplicar("sistema");
      document.dispatchEvent(new CustomEvent("tema"));
    }
  });
  aplicar(preferencia());
})();
