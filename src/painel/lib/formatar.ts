// Formatadores pt-BR do painel. Um Intl por tipo, criado uma vez (construir é bem mais caro que formatar).

// U+00A0, o espaço que o Intl põe depois do R$. Escrito pelo código para não depender de caractere invisível.
const ESPACO_INSEPARAVEL = new RegExp(String.fromCharCode(160), 'g')
const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const reaisInteiros = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** R$ com centavos, a partir de um valor em reais. */
export const formatarReais = (valor: number) => reais.format(valor)

/**
 * R$ com centavos, a partir de centavos inteiros (a contagem animada trabalha com inteiros). O espaço depois do "R$"
 * é comum, não o inseparável do Intl: num cartão estreito o valor quebra em duas linhas em vez de vazar para fora.
 */
export const formatarCentavos = (centavos: number) => reais.format(centavos / 100).replace(ESPACO_INSEPARAVEL, ' ')

/** R$ sem centavos (ranking e produtos), como o painel antigo mostrava. */
export const formatarReaisInteiros = (valor: number) => reaisInteiros.format(valor)

/** Dinheiro em centavos inteiros: a contagem anima inteiros e termina no valor exato. */
export const emCentavos = (valorEmReais: number) => Math.round(valorEmReais * 100)

/** "1 venda", "3 vendas". */
export const pluralizar = (n: number, singular: string, plural: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : plural}`

const percentualEmPontos = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

/**
 * Porcentagem já em pontos (31,3 vira "31,3%"), com no máximo 1 casa. Arredonda como o painel antigo (toFixed(1)) antes
 * de escrever: o número mostrado é o mesmo de antes, só muda a vírgula. Um Intl direto sobre a fração diverge nas
 * fronteiras (453,75 vira 453,8 no Intl e 453,7 no toFixed, porque o double está um pouco abaixo).
 */
export const formatarPercentual = (pontos: number) => `${percentualEmPontos.format(Number(pontos.toFixed(1)))}%`
