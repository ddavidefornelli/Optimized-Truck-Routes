create table strade_helsinki (
    id int primary key generated always as identity, 
    nodo_partenza int not null,               
    nodo_arrivo int not null,                  
    lunghezza_metri float not null,              
    larghezza_metri float,                      
    is_sterrata boolean default false,         
    livello_traffico int default 1,         
    is_centro_urbano boolean default false,
    curve_strette boolean default false,              
    is_pericolosa boolean default false,         
    is_non_illuminata boolean default false,       
    curve_cieche boolean default false          
);
