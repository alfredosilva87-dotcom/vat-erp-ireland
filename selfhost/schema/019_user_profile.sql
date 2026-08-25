-- Dados pessoais de quem usa o sistema.
--
-- Até aqui um utilizador era e-mail, nome e perfil. Num escritório com várias
-- pessoas a lançar no mesmo cliente, "quem foi que aprovou esta nota" responde
-- com um e-mail — e o e-mail do escritório costuma ser `info@`, `accounts@`,
-- nomes que não são de ninguém.
--
-- A FOTO fica na própria coluna, como data URL, e não no bucket de documentos.
-- Três razões: é a única imagem do sistema que não é documento fiscal (o bucket
-- tem política e retenção pensadas para nota fiscal, não para retrato); ela
-- viaja junto de `/api/auth/me`, que toda tela já chama, sem um segundo pedido
-- por avatar; e uma imagem de 256px comprimida cabe em ~20 KB, que é menos do
-- que a maioria das linhas de `invoices` desta base.
--
-- O tamanho é limitado na rota (app/api/profile/route.ts), não aqui: uma
-- restrição de coluna devolveria erro de banco cru na cara do utilizador em vez
-- de uma frase que explica o que fazer.
alter table app_users add column if not exists surname text;
alter table app_users add column if not exists phone   text;
alter table app_users add column if not exists avatar  text;
