// Máscara e validação do campo "Nascimento" (dd/mm/aaaa), reutilizado por
// CadastroCliente e AtualizarDadosCliente. Existe pra evitar o
// <input type="date"> nativo: o popup do calendário desse input é
// renderizado no idioma configurado NO NAVEGADOR do cliente, não no
// lang="pt-BR" da página — foi assim que uma cliente viu o campo em inglês
// mesmo com o resto do app em português.

const IDADE_MAXIMA = 120;

// Aplica a máscara a cada digitação, mantendo só dígitos e inserindo as
// barras automaticamente. `valorAnterior` é o valor mascarado que já estava
// no campo — usado só pra deixar o backspace apagar a barra corretamente
// (sem isso, apagar a barra "não faz nada" porque ela é readicionada).
export function aplicarMascaraNascimento(valorAnterior, valorNovo) {
  const digitosAnteriores = (valorAnterior ?? "").replace(/\D/g, "");
  let digitos = (valorNovo ?? "").replace(/\D/g, "");

  if (
    valorNovo.length === valorAnterior.length - 1 &&
    digitos.length === digitosAnteriores.length
  ) {
    digitos = digitos.slice(0, -1);
  }

  digitos = digitos.slice(0, 8);

  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
}

// Converte "aaaa-mm-dd" (formato salvo em `clientes.nascimento`) para o
// valor mascarado "dd/mm/aaaa" exibido no campo. Aceita timestamp completo,
// usando só os 10 primeiros caracteres.
export function paraExibicaoNascimento(valorArmazenado) {
  if (!valorArmazenado) return "";
  const [ano, mes, dia] = String(valorArmazenado).slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "";
  return `${dia}/${mes}/${ano}`;
}

function diasNoMes(ano, mes) {
  return new Date(ano, mes, 0).getDate();
}

function calcularIdade(nascimento, referencia) {
  let idade = referencia.getFullYear() - nascimento.getFullYear();
  const aindaNaoFezAniversario =
    referencia.getMonth() < nascimento.getMonth() ||
    (referencia.getMonth() === nascimento.getMonth() &&
      referencia.getDate() < nascimento.getDate());
  if (aindaNaoFezAniversario) idade--;
  return idade;
}

// Valida o valor mascarado "dd/mm/aaaa" completo: dia/mês dentro do
// calendário (considerando ano bissexto), data não pode ser futura, e
// idade até 120 anos — pega erros óbvios de digitação (ex.: dia e mês
// trocados, ano incompleto) sem travar nascimentos reais. Retorna
// { erro: null, iso: null } pra valor vazio (campo opcional depende de
// quem chama exigir ou não).
export function validarNascimento(valorMascarado) {
  const digitos = (valorMascarado ?? "").replace(/\D/g, "");
  if (digitos.length === 0) return { erro: null, iso: null };
  if (digitos.length < 8) {
    return { erro: "Data de nascimento incompleta. Use o formato dd/mm/aaaa.", iso: null };
  }

  const dia = Number(digitos.slice(0, 2));
  const mes = Number(digitos.slice(2, 4));
  const ano = Number(digitos.slice(4, 8));

  if (mes < 1 || mes > 12) {
    return { erro: "Data de nascimento inválida. Use o formato dd/mm/aaaa.", iso: null };
  }
  if (dia < 1 || dia > diasNoMes(ano, mes)) {
    return { erro: "Data de nascimento inválida. Use o formato dd/mm/aaaa.", iso: null };
  }

  const dataNascimento = new Date(ano, mes - 1, dia);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  if (dataNascimento > hoje) {
    return { erro: "A data de nascimento não pode ser no futuro.", iso: null };
  }
  if (calcularIdade(dataNascimento, hoje) > IDADE_MAXIMA) {
    return { erro: "Confira a data de nascimento digitada.", iso: null };
  }

  const iso = `${digitos.slice(4, 8)}-${digitos.slice(2, 4)}-${digitos.slice(0, 2)}`;
  return { erro: null, iso };
}
