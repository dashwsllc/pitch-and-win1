import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createComponentLoader } from './helpers/meta-component-harness.mjs'
const load = createComponentLoader({'@/integrations/supabase/client':{},'@/hooks/useAuth':{},'@/lib/arena-api':{}})
const render = (name, props) => renderToStaticMarkup(React.createElement(load('src/components/' + name)[name.split('/').at(-1).replace('.tsx','')], props))
const question = (name, ...values) => ({ name, values })
const qualification = [
 question('quem_está_preenchendo_este_formulário?', 'sou_o_atleta'),
 question('atualmente,_o_atleta_está_vinculado_a_algum_clube?', 'Não'),
 question('o_atleta_já_participou_de_avaliações_ou_peneiras_em_clubes?', 'Sim'),
 question('o_atleta_já_recebeu_alguma_oportunidade_relevante_de_um_clube?', 'Não'),
 question('qual_é_o_principal_objetivo_do_atleta_no_futebol_hoje?', 'Tornar-se profissional'),
 question('o_que_mais_está_impedindo_o_atleta_de_chegar_onde_deseja_hoje?', 'Falta de oportunidades'),
 question('qual_é_a_posição_e_a_categoria_atual_do_atleta?', 'Ala, sub-17'),
 question('quais_são_os_principais_clubes_que_o_atleta_já_representou?', 'Clube sintético'),
 question('quais_clubes_avaliou_e_qual_foi_o_resultado?', 'Avaliação sintética sem aprovação'),
 question('quais_são_as_3_principais_características_do_atleta_como_jogador_e_o_que_ele_mais_precisa_melhorar?', 'Velocidade, passe e finalização'),
 question('de_0_a_10,_quanto_o_atleta_está_comprometido_em_buscar_seu_objetivo_no_futebol?__escala_de_0_a_10', '8/10'),
]
test('campaign qualification appears in useful categories with all eleven answers', () => {
 const html = render('traffic/FormAnswers.tsx', { fields: qualification })
 for (const title of ['Contato e identificação','Perfil do atleta','Histórico no futebol','Objetivos e dificuldades','Comprometimento']) assert(html.includes(title), title + ' missing')
 assert.equal((html.match(/<dt/g)??[]).length,11)
 assert.match(html,/Sou o atleta|sou o atleta/)
 assert.match(html,/Ala, sub-17/)
 assert.match(html,/Avaliação sintética sem aprovação/)
})
test('manual raw columns missing from field_data are readable without opening JSON', () => {
 const html = render('crm/CRMImportDetails.tsx', { lead: { import_channel:'form', import_method:'manual',import_snapshot:{
  field_data:[question('full_name','Contato sintético')], source_snapshot:{manual_row:{raw_cells:[
   {header:'full_name',value:'Contato sintético'},
   {header:'qual_é_o_principal_objetivo_do_atleta_no_futebol_hoje?',value:'Objetivo só na coluna original'},
   {header:'Pergunta nova da campanha',value:'Resposta adicional preservada'},
   {header:'Pergunta vazia',value:''},
  ]}}
 } } })
 assert.match(html,/<dd[^>]*>Objetivo só na coluna original<\/dd>/)
 assert.match(html,/<dd[^>]*>Resposta adicional preservada<\/dd>/)
 assert.match(html,/Pergunta vazia/)
 assert.match(html,/Não informado na origem/)
})
test('website full profile and report take precedence over the clipped secondary summary', () => {
 const tail = 'Final do contexto integral <script>não executar</script>'
 const original = 'Informação valiosa '.repeat(150) + tail
 const html = render('crm/CRMImportDetails.tsx', { lead:{ import_channel:'website',import_method:'automatic',import_snapshot:{
  field_data:[question('notes','RESUMO CORTADO')],source_snapshot:{site_event:{payload:{
   contact:{name:'Contato sintético',phone:'11999990000'},profile:{position:'Ala',notes:original,age:0,active:false,unknown:['opção A','opção B']},
   attribution:{utm_campaign:'Campanha sintética'}, report:{summary:'RELATÓRIO INTEGRAL',stats:{passing:85}}
  }}}
 } } })
 assert.match(html,/<dd[^>]*>Informação valiosa /)
 assert.match(html,/Final do contexto integral &lt;script&gt;não executar&lt;\/script&gt;<\/dd>/)
 assert.match(html,/<dd[^>]*>RELATÓRIO INTEGRAL<\/dd>/)
 assert.match(html,/Relatório do site/)
 assert.match(html,/<dd[^>]*>Campanha sintética<\/dd>/)
 assert.match(html,/<dd[^>]*>0<\/dd>/)
 assert.match(html,/<dd[^>]*>Não<\/dd>/)
})
test('future fields and multi-choice values survive normalization without being cut or hidden', () => {
 const html = render('traffic/FormAnswers.tsx', { fields:[question('Nova pergunta?', 'Primeira opção', 'Segunda opção'),{name:'Consentimento',values:[false,0]},question('Objetivo vazio?')] })
 assert.match(html,/Outras respostas/)
 assert.match(html,/Primeira opção/);assert.match(html,/Segunda opção/)
 assert.match(html,/Não/);assert.match(html,/0/)
 assert.match(html,/Não informado na origem/)
})
test('future site sections and divergent original values remain readable with their provenance', () => {
 const html = render('crm/CRMImportDetails.tsx', {lead:{import_channel:'website',import_method:'automatic',import_snapshot:{source_snapshot:{site_event:{payload:{
  contact:{phone:'11999990000'},source_record:{phone:'(11) 99999-0000',email:'qa@example.invalid'},
  qualification:{goal:'Objetivo em seção nova',answers:[{question:'Contexto futuro?',answer:'RESPOSTA FUTURA INTEGRAL'}]}
 }}}}}})
 assert.match(html,/<dd[^>]*>\(11\) 99999-0000<\/dd>/)
 assert.match(html,/<dt[^>]*>Registro original \/ WhatsApp<\/dt>/)
 assert.match(html,/<dd[^>]*>Objetivo em seção nova<\/dd>/)
 assert.match(html,/<dd[^>]*>RESPOSTA FUTURA INTEGRAL<\/dd>/)
})
test('traffic corrections are separate from the original submitted Meta answers', () => {
 const html=render('crm/CRMImportDetails.tsx',{lead:{import_channel:'form',import_method:'automatic',import_snapshot:{
  field_data:[question('qual_é_o_principal_objetivo_do_atleta_no_futebol_hoje?','Resposta revista por Tráfego')],
  source_snapshot:{field_data:[question('qual_é_o_principal_objetivo_do_atleta_no_futebol_hoje?','Resposta enviada pelo atleta')]}
 }}})
 assert.match(html,/<dd[^>]*>Resposta enviada pelo atleta<\/dd>/)
 assert.match(html,/<dd[^>]*>Resposta revista por Tráfego<\/dd>/)
 assert.match(html,/Dados revisados/)
})
test('site contact and athlete profile keep separate identities even when names coincide', () => {
 const html=render('crm/CRMImportDetails.tsx',{lead:{import_channel:'website',import_method:'automatic',import_snapshot:{source_snapshot:{site_event:{payload:{
  contact:{name:'Nome sintético igual',phone:'11999990000'},profile:{name:'Nome sintético igual',city:'Cidade do atleta'}
 }}}}}})
 assert.equal((html.match(/<dd[^>]*>Nome sintético igual<\/dd>/g)??[]).length,2)
 assert.match(html,/<dt[^>]*>Contato \/ Nome informado<\/dt>/)
 assert.match(html,/<dt[^>]*>Perfil do atleta \/ Nome informado<\/dt>/)
})
test('readability must not change emails, campaign attribution or literal report references', () => {
 const html=render('traffic/FormAnswers.tsx',{fields:[question('email','nome_sobrenome@example.invalid'),question('utm_campaign','campanha_teste'),question('Relatório / Referência','relatorio_teste')]})
 assert.match(html,/<dd[^>]*>nome_sobrenome@example.invalid<\/dd>/)
 assert.match(html,/<dd[^>]*>campanha_teste<\/dd>/)
 assert.match(html,/<dd[^>]*>relatorio_teste<\/dd>/)
})
test('CRM context contains answers and readable consent without operational JSON or staff metadata', () => {
 const html=render('crm/CRMImportDetails.tsx',{lead:{import_channel:'form',import_method:'automatic',import_snapshot:{
  imported_by:'PRIVATE-OPERATOR',reviewed_by:'PRIVATE-REVIEWER',crm_sync_status:'enviado',
  field_data:[question('Objetivo do atleta?','Ser profissional'),question('imported_by','PRIVATE-OPERATOR'),question('reviewed_by','PRIVATE-REVIEWER')],
  custom_disclaimer_responses:[{title:'Contato autorizado',accepted:true}]
 }}})
 assert.match(html,/Ser profissional/);assert.match(html,/Contato autorizado/)
 assert.doesNotMatch(html,/PRIVATE-OPERATOR|PRIVATE-REVIEWER|imported_by|reviewed_by|crm_sync_status|<pre/)
})
