-- Internal helpers are only for other functions; signed-in users must not read stock figures through them.
alter function public.order_lines_guard() security definer;
revoke execute on function public.item_balance(bigint, text, date) from authenticated;
revoke execute on function public.order_line_committed(bigint) from authenticated;
