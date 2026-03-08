-- Update All Friends circle emoji to 👯
update public.circles set emoji = '👯' where is_all_friends = true;
