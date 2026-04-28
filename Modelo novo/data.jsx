// Sample data — Brazilian standards for cavaquinho repertoire

const SAMPLE_MUSICAS = [
  { id:'m1',  titulo:'Aquarela do Brasil',     artista:'Ary Barroso',         tom:'F',    tags:['Samba','Choro'],     bpm:128, dur:'3:42', fav:true,  notas:'Intro arpejada — atenção ao ritmo do refrão.' },
  { id:'m2',  titulo:'Pagode em Brasília',     artista:'Waldir Azevedo',      tom:'D',    tags:['Choro'],             bpm:140, dur:'2:58', fav:true,  notas:'Solo principal no cavaco. Subir 2ª voz no B.' },
  { id:'m3',  titulo:'Carinhoso',              artista:'Pixinguinha',         tom:'A',    tags:['Choro','MPB'],       bpm:72,  dur:'4:10', fav:true,  notas:'Tempo lento, expressivo. Ritardando no fim.' },
  { id:'m4',  titulo:'Trem das Onze',          artista:'Adoniran Barbosa',    tom:'G',    tags:['Samba'],             bpm:108, dur:'3:18', fav:false, notas:'' },
  { id:'m5',  titulo:'Coração Vagabundo',      artista:'Caetano Veloso',      tom:'C',    tags:['MPB'],               bpm:88,  dur:'2:46', fav:false, notas:'' },
  { id:'m6',  titulo:'Deixa a Vida Me Levar',  artista:'Zeca Pagodinho',      tom:'E',    tags:['Pagode'],            bpm:104, dur:'4:02', fav:true,  notas:'Coro do refrão chama o público.' },
  { id:'m7',  titulo:'Tico-Tico no Fubá',      artista:'Zequinha de Abreu',   tom:'Em',   tags:['Choro'],             bpm:152, dur:'2:34', fav:false, notas:'Acelerar gradualmente nas voltas.' },
  { id:'m8',  titulo:'Águas de Março',         artista:'Tom Jobim',           tom:'D',    tags:['MPB','Bossa'],       bpm:120, dur:'3:32', fav:true,  notas:'' },
  { id:'m9',  titulo:'O Show Tem Que Continuar',artista:'Beth Carvalho',      tom:'Bm',   tags:['Samba'],             bpm:96,  dur:'3:48', fav:false, notas:'' },
  { id:'m10', titulo:'Camisa Amarela',         artista:'Ataulfo Alves',       tom:'F',    tags:['Samba'],             bpm:112, dur:'3:08', fav:false, notas:'' },
  { id:'m11', titulo:'Brasileirinho',          artista:'Waldir Azevedo',      tom:'A',    tags:['Choro'],             bpm:148, dur:'2:22', fav:true,  notas:'Bis comum em apresentações.' },
  { id:'m12', titulo:'Verdade',                artista:'Zeca Pagodinho',      tom:'G',    tags:['Pagode'],            bpm:100, dur:'3:54', fav:false, notas:'' },
  { id:'m13', titulo:'Chega de Saudade',       artista:'Tom Jobim',           tom:'Dm',   tags:['Bossa','MPB'],       bpm:128, dur:'3:14', fav:true,  notas:'' },
  { id:'m14', titulo:'Asa Branca',             artista:'Luiz Gonzaga',        tom:'D',    tags:['Forró'],             bpm:116, dur:'2:48', fav:false, notas:'' },
  { id:'m15', titulo:'Coisinha do Pai',        artista:'Beth Carvalho',       tom:'C',    tags:['Samba'],             bpm:108, dur:'3:24', fav:false, notas:'' },
  { id:'m16', titulo:'O Mundo é um Moinho',    artista:'Cartola',             tom:'Am',   tags:['Samba','MPB'],       bpm:80,  dur:'4:32', fav:true,  notas:'Letra emotiva, andar devagar.' },
  { id:'m17', titulo:'Lanterna dos Afogados',  artista:'Paralamas',           tom:'C',    tags:['MPB','Rock'],        bpm:96,  dur:'4:12', fav:false, notas:'' },
  { id:'m18', titulo:'Camarão que Dorme',      artista:'Zeca Pagodinho',      tom:'A',    tags:['Pagode'],            bpm:104, dur:'3:38', fav:false, notas:'' },
];

const SAMPLE_REPERTORIOS = [
  { id:'r1', nome:'Roda de Samba — Sábado',     descricao:'Casa do Choro · 21h',            songs:['m1','m4','m6','m10','m12','m15','m18'], cor:'gold' },
  { id:'r2', nome:'Show Choro Vivo',             descricao:'Teatro Municipal · 19h30',       songs:['m2','m3','m7','m11','m13'],             cor:'copper' },
  { id:'r3', nome:'Casamento Helena & Pedro',    descricao:'Sítio Vale Verde · 16h',         songs:['m3','m5','m8','m13','m16','m17'],       cor:'emerald' },
  { id:'r4', nome:'Aniversário Vovó Lúcia',     descricao:'Repertório familiar · 14h',      songs:['m1','m6','m9','m14','m15'],             cor:'gold' },
];

// Cifra de exemplo — Aquarela do Brasil (estrutura típica)
const SAMPLE_CIFRA = [
  { tipo:'secao', texto:'Intro' },
  { tipo:'acordes', texto:'F            C7           F            C7' },
  { tipo:'secao', texto:'Verso 1' },
  { tipo:'acordes', texto:'F                                Gm7' },
  { tipo:'letra',   texto:'Brasil, meu Brasil brasileiro' },
  { tipo:'acordes', texto:'C7                               F' },
  { tipo:'letra',   texto:'Meu mulato inzoneiro, vou cantar-te nos meus versos' },
  { tipo:'acordes', texto:'F            Bb            C7         F' },
  { tipo:'letra',   texto:'Ó Brasil, samba que dá, bamboleio que faz gingar' },
  { tipo:'secao', texto:'Refrão' },
  { tipo:'acordes', texto:'Bb                       F' },
  { tipo:'letra',   texto:'Ó esse coqueiro que dá coco' },
  { tipo:'acordes', texto:'G7                       C7' },
  { tipo:'letra',   texto:'Onde eu amarro a minha rede' },
  { tipo:'acordes', texto:'F             D7      Gm7    C7   F' },
  { tipo:'letra',   texto:'Nas noites claras de luar — ô, ô, ô' },
  { tipo:'secao', texto:'Verso 2' },
  { tipo:'acordes', texto:'F                                Gm7' },
  { tipo:'letra',   texto:'Brasil, terra boa e gostosa' },
  { tipo:'acordes', texto:'C7                               F' },
  { tipo:'letra',   texto:'Da morena sestrosa de olhar indiferente' },
  { tipo:'acordes', texto:'F            Bb            C7         F' },
  { tipo:'letra',   texto:'Ó Brasil, verde que dá, para o mundo se admirar' },
  { tipo:'secao', texto:'Final' },
  { tipo:'acordes', texto:'F   Bb   C7   F' },
];

const SAMPLE_GRADE = [
  { secao:'Intro',    compassos:'| F | C7 | F | C7 |' },
  { secao:'A',        compassos:'| F | F | Gm7 | C7 | F | F | Bb C7 | F |' },
  { secao:'Refrão',   compassos:'| Bb | Bb | F | F | G7 | G7 | C7 | C7 |' },
  { secao:'B',        compassos:'| F | D7 | Gm7 | C7 | F | F | C7 | F |' },
  { secao:'Final',    compassos:'| F | Bb | C7 | F |' },
];

// Stats data
const STATS = {
  total:18, favoritas:8, repertorios:4, duracaoTotal:'1h 02min',
  topArtistas:[
    { nome:'Waldir Azevedo', n:2 },
    { nome:'Zeca Pagodinho', n:3 },
    { nome:'Tom Jobim', n:2 },
    { nome:'Beth Carvalho', n:2 },
    { nome:'Pixinguinha', n:1 },
    { nome:'Cartola', n:1 },
  ],
  tons:[
    { t:'F', n:3 }, { t:'D', n:3 }, { t:'C', n:3 }, { t:'A', n:2 },
    { t:'G', n:2 }, { t:'E', n:1 }, { t:'Em', n:1 }, { t:'Am', n:1 }, { t:'Bm', n:1 }, { t:'Dm', n:1 },
  ],
  estilos:[
    { tag:'Samba', n:6 }, { tag:'Choro', n:5 }, { tag:'MPB', n:6 },
    { tag:'Pagode', n:3 }, { tag:'Bossa', n:2 }, { tag:'Forró', n:1 }, { tag:'Rock', n:1 },
  ],
};

Object.assign(window, { SAMPLE_MUSICAS, SAMPLE_REPERTORIOS, SAMPLE_CIFRA, SAMPLE_GRADE, STATS });
