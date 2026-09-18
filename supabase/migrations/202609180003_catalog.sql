insert into public.catalog_options(size_code,width_cm,height_cm,price_jpy,version) values
('S',20,20,10000,1),('M',30,40,20000,1),('L',50,60,35000,1)
on conflict(size_code) do nothing;
