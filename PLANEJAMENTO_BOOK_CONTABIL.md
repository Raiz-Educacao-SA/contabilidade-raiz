# Planejamento do módulo Book Contábil

## 1. Objetivo do produto

Centralizar o fechamento contábil em um único ambiente, eliminando planilhas paralelas de controle e garantindo que cada conta patrimonial tenha:

- saldo contábil e razão atualizados a partir da fonte oficial;
- documentação suporte obrigatória e versionada;
- memória de cálculo ou regra de conciliação;
- identificação e tratamento das divergências;
- responsável pela preparação e responsável pela revisão;
- evidência de aprovação e trilha completa de auditoria;
- status inequívoco de conciliação por empresa, filial, período e conta;
- reabertura automática quando houver movimentação posterior à conciliação.

O saldo contábil nunca deverá ser digitado manualmente. Ele será lido da origem oficial e armazenado como fotografia auditável do momento da conciliação.

## 2. Princípios funcionais

1. **Fonte única:** balancete e razão vêm diretamente do sistema contábil.
2. **Conciliação por competência:** o controle é identificado por `CODCOLIGADA`, período e conta contábil. `CODFILIAL` será opcional e utilizado apenas quando a origem ou a análise patrimonial exigir esse detalhamento.
3. **Evidência obrigatória:** conta patrimonial não pode ser concluída sem o documento suporte definido em sua matriz.
4. **Igualdade exata:** o check de conciliada somente será liberado quando a diferença for `0,00`, salvo política formal de tolerância aprovada no futuro.
5. **Execução e validação auditáveis:** no MVP, o mesmo analista poderá executar e validar a conciliação, mas o sistema registrará as duas ações separadamente. A segregação entre preparador e revisor ficará disponível para uma fase posterior.
6. **Imutabilidade auditável:** uma conciliação aprovada não é sobrescrita; correções geram nova versão ou reabertura registrada.
7. **Movimento posterior invalida o check:** lançamento novo ou alterado após a conciliação reabre a conta automaticamente.
8. **Sem escrita direta no banco do TOTVS:** integrações de alteração, quando necessárias, devem usar interfaces oficiais e autorização específica.

## 3. Escopo funcional

### 3.1 Painel do fechamento

Visão por competência, coligada e filial contendo:

- total de contas patrimoniais;
- não iniciadas;
- aguardando documentação;
- em conciliação;
- com divergência;
- preparadas e aguardando revisão;
- conciliadas;
- reabertas após movimentação;
- percentual concluído e atrasos por responsável.

### 3.2 Menu Relatórios Base

O módulo terá um menu provisoriamente denominado **Relatórios Base**, composto por:

1. **Balancete** — consulta de saldos e movimentação do período.
2. **Razão** — detalhamento dos lançamentos da conta selecionada.
3. **Plano de Contas** — hierarquia de contas e ponto de seleção das contas que farão parte do Book Contábil.

No Plano de Contas, o analista poderá indicar progressivamente:

- quais contas patrimoniais entram no processo de conciliação;
- a categoria funcional da conta, como bancos, clientes, fornecedores, tributos ou imobilizado;
- qual relatório ou documento será utilizado como suporte;
- qual regra será usada para conferir o saldo;
- a partir de qual competência a regra passa a valer.

### 3.3 Balancete on-line

- filtros por coligada, competência e conta; filial e centro de custo serão opcionais, conforme disponibilidade e necessidade confirmadas na origem;
- saldos inicial, débitos, créditos e saldo final;
- data e hora da última atualização;
- acesso direto da linha da conta para sua conciliação;
- comparação entre a fotografia utilizada na aprovação e o saldo atual.

### 3.4 Razão on-line

- movimentos detalhados da conta e do período;
- filtros por data, lote, documento, histórico, valor e demais campos confirmados no schema;
- vínculo de partidas contábeis com itens da documentação suporte;
- marcação de partidas conciliadas e pendentes;
- exportação apenas como apoio, sem transformar a exportação no controle oficial.

### 3.5 Plano de Contas e matriz de documentação suporte

Cada conta ou grupo de contas terá uma regra cadastrada:

| Campo | Finalidade |
|---|---|
| Conta ou intervalo | Define onde a regra se aplica |
| Tipo de suporte | Extrato, relatório auxiliar, composição, contrato, nota, memória de cálculo etc. |
| Formato aceito | PDF, OFX, CNAB, CSV, integração estruturada ou outro formato aprovado |
| Obrigatoriedade | Documento obrigatório, complementar ou dispensado com justificativa |
| Regra de conciliação | Como o suporte deve formar ou explicar o saldo |
| Frequência | Mensal, diária, trimestral ou por evento |
| Analista executor e validador | No MVP, poderá ser a mesma pessoa; a evolução permitirá segregação |
| Prazo | Data limite relativa ao fechamento |

Exemplos iniciais:

- bancos: extrato bancário como evidência; OFX/CNAB ou integração estruturada para conciliação automática;
- contas a receber: relatório auxiliar do contas a receber e composição das diferenças contra a contabilidade;
- fornecedores: relatório de contas a pagar;
- folha e encargos: relatórios da folha, guias e composições por competência;
- tributos: apurações, declarações e guias;
- imobilizado: razão auxiliar e relatório de depreciação;
- intercompany: confirmação da contraparte e espelhamento dos saldos.

### 3.6 Área da conta

Para cada conta e período:

- saldo contábil atual e saldo da fotografia aprovada;
- razão do período;
- documentos suporte e respectivas versões;
- valor formado pelo suporte;
- diferença contabilidade versus suporte;
- itens conciliados, pendentes e justificativas;
- comentários e solicitações de ajuste;
- analista executor, analista validador, datas e histórico;
- ações de executar, enviar para validação, validar, devolver e reabrir.

## 4. Fluxo e estados

Fluxo padrão:

1. **Não iniciada** — conta criada para a competência.
2. **Aguardando documentação** — suporte obrigatório ainda ausente ou inválido.
3. **Em conciliação** — documentos presentes e análise em andamento.
4. **Com divergência** — diferença diferente de `0,00` ou item sem correspondência.
5. **Aguardando validação** — diferença zerada e execução concluída.
6. **Conciliada** — validação concluída e check registrado.
7. **Reaberta** — movimentação posterior, troca de documento ou rejeição invalidou a aprovação.

Regras do check de conciliada:

- documentação obrigatória presente e válida;
- saldo contábil atualizado;
- valor do suporte calculado ou informado com memória de cálculo;
- diferença igual a `0,00`;
- nenhuma pendência crítica aberta;
- evento explícito de validação registrado, ainda que executado pelo mesmo analista durante o MVP;
- fotografia dos saldos e hash dos documentos registrados.

## 5. Conciliações prioritárias

### 5.1 Bancos

- importar extrato estruturado quando disponível;
- comparar saldo inicial, entradas, saídas e saldo final;
- realizar matching por valor, data, documento e regras configuráveis;
- separar partidas conciliadas, lançamentos somente no banco e lançamentos somente na contabilidade;
- manter o PDF do extrato como evidência visual, sem depender dele como única fonte de cálculo.

### 5.2 Contas a receber

Objetivo inicial: explicar por que o relatório auxiliar atual não fecha com o saldo contábil.

- capturar o relatório auxiliar em formato estruturado;
- comparar o saldo final auxiliar com o saldo da conta contábil;
- reconciliar movimentações por documento, cliente, vencimento, baixa, data e valor, conforme campos realmente disponíveis;
- classificar divergências: contabilização ausente, título ausente, baixa em competência diferente, cancelamento, estorno, conta incorreta, filial incorreta, corte de data ou diferença de parametrização;
- permitir composição auditável das diferenças até que a soma seja igual ao saldo contábil;
- impedir o check enquanto a diferença não for zerada.

## 6. Trava e proteção após conciliação

A proteção deve ter duas camadas:

### Camada 1 — controle imediato no Book Contábil

- congelar a versão conciliada;
- detectar qualquer alteração no saldo ou no razão após a aprovação;
- remover automaticamente o check e mudar o status para **Reaberta**;
- registrar qual movimento provocou a reabertura;
- notificar analista executor, analista validador e responsável pelo fechamento.

### Camada 2 — trava sistêmica na origem

- confirmar quais mecanismos oficiais o TOTVS RM oferece para bloqueio por período, lote, perfil, processo ou conta;
- não presumir que exista bloqueio nativo por conta contábil;
- implementar trava dura somente por interface oficial e após homologação;
- prever liberação emergencial com justificativa, aprovação, prazo e trilha de auditoria;
- caso a origem não permita bloqueio granular, usar fechamento de período combinado com monitoramento automático de lançamentos posteriores.

O MVP deve começar pela reabertura automática. A trava dura será uma etapa posterior, pois bloquear lançamento na origem possui impacto operacional amplo.

## 7. Arquitetura-alvo

Componentes necessários:

- **Aplicação web:** módulo Book Contábil dentro do Contabilidade Raiz.
- **API de negócio:** períodos, contas, documentos, conciliações, aprovações e auditoria.
- **Banco transacional:** estados do fechamento, regras, vínculos e histórico.
- **Armazenamento de documentos:** arquivos com controle de versão, hash, metadados e retenção.
- **Integração contábil somente leitura:** balancete e razão por API/WebService oficial ou consultas validadas; SQL direto de leitura deve usar `WITH (NOLOCK)` em todas as tabelas e views.
- **Processador de conciliação:** importação, normalização, matching e cálculo de diferenças.
- **Monitor de alterações:** identifica movimentos posteriores à aprovação.
- **Autorização:** perfis de analista, administrador e auditor no MVP; perfil revisor separado em fase posterior.
- **Auditoria:** registro append-only de todas as mudanças relevantes.

Antes de definir tecnologia e endpoints, será necessário obter o código-fonte do app, o modelo de autenticação, o banco utilizado e o schema real da origem contábil.

## 8. Modelo mínimo de dados

- `closing_period`: coligada, filial, competência, calendário, status e responsáveis.
- `account_rule`: conta/grupo, tipo de suporte, regra, prazo e papéis.
- `account_reconciliation`: período, conta, saldos, diferença, estado e versão.
- `ledger_snapshot`: fotografia do razão usada na análise.
- `support_document`: arquivo, tipo, período, hash, versão, origem e validade.
- `support_item`: linha estruturada importada do documento ou relatório.
- `reconciliation_match`: vínculo entre movimento contábil e item auxiliar.
- `reconciliation_difference`: divergência, categoria, responsável e resolução.
- `approval`: execução, validação, decisão, usuário e data.
- `audit_event`: evento imutável com estado anterior, estado posterior e origem.
- `lock_event`: bloqueio, reabertura, liberação excepcional e justificativa.

## 9. Roadmap de implementação

### Fase 0 — fundação e descoberta

- obter o repositório correto do Contabilidade Raiz;
- mapear autenticação, banco, hospedagem, perfis e integrações existentes;
- definir coligada, competência piloto e, somente se necessário, filial;
- confirmar fonte e schema do balancete e razão;
- cadastrar a primeira matriz de contas e documentos suporte.

### Fase 1 — MVP de leitura e controle

- menu **Relatórios Base** com Plano de Contas, Balancete e Razão on-line;
- seleção progressiva, pelo Plano de Contas, das contas que participarão do Book;
- criação automática das contas do fechamento;
- upload e versionamento de documentos;
- estados, responsáveis, comentários e histórico;
- check manual condicionado a documento, diferença zero e revisão;
- detecção e reabertura por movimentação posterior.

### Fase 2 — conciliação de bancos

- importação estruturada de extratos;
- matching automático e manual;
- painel de pendências e composição da diferença;
- aprovação e evidências auditáveis.

### Fase 3 — conciliação de contas a receber

- integração com o relatório auxiliar;
- comparação contabilidade versus títulos e baixas;
- classificação das causas das diferenças;
- composição e acompanhamento até zerar o saldo.

### Fase 4 — expansão patrimonial

- fornecedores, folha, tributos, imobilizado, empréstimos, intercompany e demais grupos;
- regras específicas por tipo de conta;
- indicadores de recorrência e qualidade do fechamento.

### Fase 5 — trava sistêmica e fechamento formal

- homologar o mecanismo oficial disponível no TOTVS RM;
- implantar bloqueio, liberação excepcional e auditoria;
- monitorar tentativas e lançamentos posteriores;
- formalizar encerramento da competência.

## 10. Primeira entrega recomendada

O primeiro incremento deve ser pequeno e completo:

1. escolher uma `CODCOLIGADA` e uma competência; `CODFILIAL` será opcional;
2. criar o menu **Relatórios Base** com Plano de Contas, Balancete e Razão somente leitura;
3. selecionar pelo Plano de Contas uma conta bancária e uma conta de clientes;
4. cadastrar, conforme indicação do analista, o relatório ou documento suporte de cada conta;
5. disponibilizar upload, cálculo da diferença, estados, execução e validação;
6. liberar o check somente com diferença `0,00`;
7. reabrir automaticamente se o razão mudar.

Critérios de aceite:

- nenhum saldo digitado manualmente;
- origem e horário de atualização visíveis;
- razão navegável dentro do app;
- documentos versionados e vinculados à conta/período;
- diferença calculada e explicada;
- execução e validação registradas separadamente, mesmo quando feitas pelo mesmo analista no MVP;
- check auditável;
- qualquer movimento posterior remove o status conciliado.

## 11. Informações para iniciar o piloto

Para cada conta, registrar:

- `CODCOLIGADA` e, quando realmente aplicável, `CODFILIAL`;
- competência;
- código e nome da conta contábil;
- natureza esperada do saldo;
- documento suporte obrigatório;
- sistema ou relatório de origem do suporte;
- formato disponível;
- analista responsável pela execução e validação;
- prazo;
- divergência conhecida e exemplo real sem dados pessoais desnecessários.

O piloto recomendado começa com uma conta bancária e a conta de contas a receber que atualmente apresenta divergência.

## 12. Localização do código-fonte do app

O endereço publicado na Vercel não é o repositório de código. O código poderá estar em um destes locais:

- repositório GitHub, GitLab ou Bitbucket conectado ao projeto da Vercel;
- pasta local no computador do colega que iniciou o desenvolvimento;
- tarefa ou workspace do Codex/ChatGPT em que os arquivos foram gerados;
- arquivo compactado compartilhado entre os participantes;
- repositório ainda não publicado, caso o deploy tenha sido feito pela máquina do desenvolvedor.

Para o trabalho simultâneo em várias frentes, a referência correta deve ser um único repositório Git compartilhado. O responsável atual deverá informar a URL do repositório ou publicar o código existente antes de começarmos alterações paralelas, evitando versões divergentes do sistema.

## 13. Estado técnico confirmado no repositório

O repositório compartilhado foi conectado e analisado em 5 de agosto de 2026.

- repositório: `luandasilva-prog/contabilidade-raiz`;
- branch principal: `main`;
- stack web: Next.js 16, React 19 e TypeScript;
- autenticação, banco e armazenamento: Supabase;
- hospedagem: Vercel;
- integração contábil: WebService do TOTVS RM;
- consulta de balancete já implantada: `CUBO.CTB.002`;
- filtro patrimonial já utilizado: empresa por `CODCOLIGADA` e competência mensal;
- Book atual: tela única de balancete on-line;
- lacunas imediatas: navegação de Relatórios Base, Plano de Contas, Razão e estruturas persistentes de conciliação/documentação.

A primeira implementação na branch `codex/book-contabil` cria o menu **Relatórios Base** com Balancete, Razão e Plano de Contas, preservando integralmente a consulta existente do balancete. Razão e Plano de Contas ficam identificados como integrações seguintes, sem simular dados ou depender de planilhas.
