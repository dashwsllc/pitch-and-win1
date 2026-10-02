// validar-paleta.mjs — confere as cores de dados de um gráfico (2 a 8 cores, na ordem em que serão usadas).
// Uso (uma vez por tema; o 3º argumento é a cor do CARTÃO onde o gráfico fica, não a do fundo da página):
//   node validar-paleta.mjs "#cor1,#cor2,#cor3" claro  "#ffffff"
//   node validar-paleta.mjs "#cor1,#cor2,#cor3" escuro "#0d1422"
//   node validar-paleta.mjs "#etapa1,#etapa2,#etapa3" claro "#ffffff" --ordinal     (rampa do funil)
//
// SÉRIES (identidade; OKLab/OKLCH; ΔE = distância euclidiana em OKLab × 100):
//   luminosidade L: claro 0,43–0,77 · escuro 0,48–0,67                  (FAIL fora da faixa)
//   croma C ≥ 0,10 (abaixo disso a cor "vira cinza" e não identifica)   (FAIL)
//   ΔE entre vizinhas, daltonismo (protan/deutan): ≥ 8 ok · 6–8 só com o número escrito junto (WARN) · < 6 FAIL
//   ΔE entre vizinhas, visão normal: ≥ 15                               (FAIL abaixo)
//   contraste contra a superfície ≥ 3:1; abaixo (WARN) o valor TEM de aparecer escrito ao lado da marca.
// RAMPA ORDINAL (--ordinal): luminosidade monótona · degraus com ΔL ≥ 0,06 · extremo mais próximo da superfície
//   com contraste ≥ 2:1 · um só matiz (dispersão ≤ 40°).
const args = process.argv.slice(2)
const ordinal = args.includes('--ordinal')
const [lista = '', modoArg = 'claro', superficieArg] = args.filter((a) => !a.startsWith('--'))
const modo = modoArg === 'escuro' || modoArg === 'dark' ? 'escuro' : 'claro'
const superficie = (superficieArg ?? (modo === 'claro' ? '#ffffff' : '#0d1422')).toLowerCase()
const cores = lista.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
if (cores.length < 2 || !cores.every((c) => /^#[0-9a-f]{6}$/.test(c)) || !/^#[0-9a-f]{6}$/.test(superficie)) {
  console.error('Informe 2 ou mais cores no formato #rrggbb separadas por vírgula (e a superfície também em #rrggbb).')
  process.exit(2)
}

const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
}
const paraLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lin = (hex) => [1, 3, 5].map((i) => paraLinear(parseInt(hex.slice(i, i + 2), 16) / 255))
const limitar = (v) => Math.max(0, Math.min(1, v))
const simular = (hex, tipo) => { const [r, g, b] = lin(hex); return MACHADO[tipo].map((l) => limitar(l[0] * r + l[1] * g + l[2] * b)) }
const oklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const lab = (hex) => oklab(lin(hex))
const luminosidade = (hex) => lab(hex)[0]
const croma = (hex) => Math.hypot(lab(hex)[1], lab(hex)[2])
const matiz = (hex) => ((Math.atan2(lab(hex)[2], lab(hex)[1]) * 180) / Math.PI + 360) % 360
const deltaE = (a, b, tipo) => {
  const x = oklab(tipo ? simular(a, tipo) : lin(a))
  const y = oklab(tipo ? simular(b, tipo) : lin(b))
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
const brilho = (hex) => { const [r, g, b] = lin(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contraste = (a, b) => { const [alto, baixo] = [brilho(a), brilho(b)].sort((x, y) => y - x); return (alto + 0.05) / (baixo + 0.05) }

const linhas = []
const registrar = (estado, nome, detalhe) => linhas.push([estado, nome, detalhe])

if (ordinal) {
  const Ls = cores.map(luminosidade)
  const ordem = [...Ls.keys()].sort((a, b) => Ls[a] - Ls[b])
  const monotona = ordem.every((v, i) => v === i) || ordem.every((v, i) => v === Ls.length - 1 - i)
  registrar(monotona ? 'PASS' : 'FAIL', 'Luminosidade monótona', monotona ? 'os degraus vão do claro ao escuro' : `fora de ordem: L = ${Ls.map((l) => l.toFixed(2)).join(', ')}`)

  const finas = Ls.slice(1).map((l, i) => [cores[i], cores[i + 1], Math.abs(l - Ls[i])]).filter(([, , g]) => g < 0.06)
  registrar(finas.length ? 'FAIL' : 'PASS', 'Distância entre degraus', finas.length ? `degraus colados (ΔL < 0,06): ${finas.map(([a, b, g]) => `${a}↔${b} ${g.toFixed(3)}`).join(', ')}` : 'todos ΔL ≥ 0,06')

  const porL = [...cores].sort((a, b) => luminosidade(a) - luminosidade(b))
  const extremo = modo === 'claro' ? porL[porL.length - 1] : porL[0]
  const cr = contraste(extremo, superficie)
  registrar(cr >= 2 ? 'PASS' : 'FAIL', 'Extremo × superfície', `${extremo} a ${cr.toFixed(2)}:1 contra ${superficie}${cr >= 2 ? '' : ' — abaixo de 2:1'}`)

  const matizes = cores.map(matiz)
  let dispersao = Math.max(...matizes) - Math.min(...matizes)
  if (dispersao > 180) dispersao = 360 - dispersao
  registrar(dispersao <= 40 ? 'PASS' : 'FAIL', 'Um só matiz', `dispersão de ${dispersao.toFixed(0)}°${dispersao <= 40 ? '' : ' — acima de 40°, não é uma rampa'}`)
} else {
  const faixa = modo === 'claro' ? [0.43, 0.77] : [0.48, 0.67]
  const pares = cores.slice(1).map((c, i) => [cores[i], c])
  const minimo = (fn) => pares.reduce((pior, [a, b]) => { const d = fn(a, b); return !pior || d < pior.d ? { d, a, b } : pior }, null)

  const fora = cores.filter((c) => luminosidade(c) < faixa[0] || luminosidade(c) > faixa[1]).map((c) => `${c} (L ${luminosidade(c).toFixed(2)})`)
  registrar(fora.length ? 'FAIL' : 'PASS', 'Faixa de luminosidade', fora.length ? `fora de ${faixa.join('–')}: ${fora.join(', ')}` : `todas dentro de ${faixa.join('–')}`)

  const cinzas = cores.filter((c) => croma(c) < 0.1).map((c) => `${c} (C ${croma(c).toFixed(2)})`)
  registrar(cinzas.length ? 'FAIL' : 'PASS', 'Croma mínimo', cinzas.length ? `parecem cinza: ${cinzas.join(', ')}` : 'todas ≥ 0,10')

  const cvd = ['protan', 'deutan'].map((t) => ({ t, ...minimo((a, b) => deltaE(a, b, t)) })).sort((x, y) => x.d - y.d)[0]
  registrar(cvd.d >= 8 ? 'PASS' : cvd.d >= 6 ? 'WARN' : 'FAIL', 'Daltonismo (vizinhas)', `pior par ${cvd.a} ↔ ${cvd.b}: ΔE ${cvd.d.toFixed(1)} (${cvd.t})${cvd.d >= 6 && cvd.d < 8 ? ' — só vale com o número escrito junto' : ''}`)

  const normal = minimo((a, b) => deltaE(a, b))
  registrar(normal.d >= 15 ? 'PASS' : 'FAIL', 'Visão normal (vizinhas)', `pior par ${normal.a} ↔ ${normal.b}: ΔE ${normal.d.toFixed(1)}`)

  const baixos = cores.filter((c) => contraste(c, superficie) < 3).map((c) => `${c} ${contraste(c, superficie).toFixed(2)}:1`)
  registrar(baixos.length ? 'WARN' : 'PASS', `Contraste contra ${superficie}`, baixos.length ? `abaixo de 3:1 (escreva o valor ao lado da marca): ${baixos.join(', ')}` : 'todas ≥ 3:1')
}

console.log(`\n${ordinal ? 'Rampa ordinal' : 'Paleta'} (${modo}, superfície ${superficie}): ${cores.join(' ')}`)
for (const [estado, nome, detalhe] of linhas) console.log(`  [${estado}] ${nome.padEnd(26)} ${detalhe}`)
const falhou = linhas.some(([estado]) => estado === 'FAIL')
console.log(`\n  → ${falhou ? 'REPROVADA: ajuste a luminosidade ou o matiz da cor indicada e rode de novo' : 'APROVADA (WARN exige o valor escrito ao lado da marca)'}\n`)
process.exit(falhou ? 1 : 0)
