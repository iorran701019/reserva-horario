# Identidade visual

Assets de marca do projeto (logo, variações, paleta, referências).

Esta pasta é **documentação, não build**: nada aqui é importado pelo código nem
servido pelo Next.js. Assets que o app realmente usa em produção ficam em
`public/` — não misture os dois. Mover um arquivo daqui pra `public/` é uma
decisão consciente, não um acidente.

## Logo Acolhe

O logo tem 4 variações, cada uma para um tipo de fundo. Usar a errada é o
tipo de coisa que só aparece depois de impresso:

| # | Variação | Quando usar |
|---|---|---|
| 1 | Com borda | Fundos claros — a fina borda preta destaca o traço |
| 2 | Sem borda (claro) | Fundos claros, quando não precisa de borda |
| 3 | Sem borda (escuro) | Fundos escuros |
| 4 | Alto contraste | Fundos na mesma faixa de cor do logo (terracota) |

Assinatura: _cuidar em cada horário_.

## Arquivos

<!-- Liste aqui cada arquivo conforme for adicionado, com origem e data. -->

- `logo-acolhe-variacoes.png` — grade com as 4 variações acima.

## Convenções

- Nome de arquivo em kebab-case, sem acento e sem espaço.
- Guarde o original em maior resolução disponível; versões reduzidas ganham
  sufixo (`-512`, `-thumb`).
- Havendo vetor (`.svg`), ele é a fonte de verdade — o `.png` é derivado.
