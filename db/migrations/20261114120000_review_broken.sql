-- migrate:up
alter table public.review_table_that_does_not_exist add column x int;

-- migrate:down
select 1;
