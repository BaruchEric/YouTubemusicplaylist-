import type { LocalTrack } from '../types/music';

/**
 * Standard ID3v1 genre lookup table (subset of indices 0..147 covering common genres).
 */
const ID3V1_GENRES: Record<number, string> = {
  0: 'Blues',
  1: 'Classic Rock',
  2: 'Country',
  3: 'Dance',
  4: 'Disco',
  5: 'Funk',
  6: 'Grunge',
  7: 'Hip-Hop',
  8: 'Jazz',
  9: 'Metal',
  10: 'New Age',
  11: 'Oldies',
  12: 'Other',
  13: 'Pop',
  14: 'R&B',
  15: 'Rap',
  16: 'Reggae',
  17: 'Rock',
  18: 'Techno',
  19: 'Industrial',
  20: 'Alternative',
  21: 'Ska',
  22: 'Death Metal',
  24: 'Soundtrack',
  25: 'Euro-Techno',
  26: 'Ambient',
  27: 'Trip-Hop',
  28: 'Vocal',
  29: 'Jazz+Funk',
  30: 'Fusion',
  31: 'Trance',
  32: 'Classical',
  33: 'Instrumental',
  34: 'Acid',
  35: 'House',
  36: 'Game',
  37: 'Sound Clip',
  38: 'Gospel',
  39: 'Noise',
  40: 'AlternRock',
  41: 'Bass',
  42: 'Soul',
  43: 'Punk',
  44: 'Space',
  45: 'Meditative',
  46: 'Instrumental Pop',
  47: 'Instrumental Rock',
  48: 'Ethnic',
  49: 'Gothic',
  50: 'Darkwave',
  51: 'Techno-Industrial',
  52: 'Electronic',
  53: 'Pop-Folk',
  54: 'Eurodance',
  55: 'Dream',
  56: 'Southern Rock',
  58: 'Cult',
  59: 'Gangsta',
  60: 'Top 40',
  62: 'Pop/Funk',
  63: 'Jungle',
  65: 'Cabaret',
  66: 'New Wave',
  67: 'Psychedelic',
  68: 'Rave',
  69: 'Showtunes',
  71: 'Lo-Fi',
  73: 'Acid Punk',
  74: 'Acid Jazz',
  78: 'Rock & Roll',
  79: 'Hard Rock',
  80: 'Folk',
  81: 'Folk-Rock',
  84: 'Fast Fusion',
  85: 'Swing',
  86: 'Latin',
  88: 'Celtic',
  89: 'Bluegrass',
  90: 'Avantgarde',
  91: 'Gothic Rock',
  92: 'Progressive Rock',
  93: 'Psychedelic Rock',
  94: 'Symphonic Rock',
  95: 'Slow Rock',
  96: 'Big Band',
  97: 'Chorus',
  98: 'Easy Listening',
  99: 'Acoustic',
  101: 'Speech',
  103: 'Opera',
  104: 'Chamber Music',
  105: 'Sonata',
  106: 'Symphony',
  108: 'Primus',
  110: 'Satire',
  111: 'Slow Jam',
  112: 'Club',
  113: 'Tango',
  114: 'Samba',
  115: 'Folklore',
  116: 'Ballad',
  117: 'Power Ballad',
  118: 'Rhythmic Soul',
  119: 'Freestyle',
  121: 'Punk Rock',
  122: 'Drum Solo',
  123: 'A Cappella',
  124: 'Euro-House',
  125: 'Dance Hall',
  126: 'Goa',
  127: 'Drum & Bass',
  128: 'Club-House',
  129: 'Hardcore',
  130: 'Terror',
  131: 'Indie',
  132: 'BritPop',
  136: 'Christian Gangsta',
  137: 'Heavy Metal',
  138: 'Black Metal',
  141: 'Christian Rock',
  142: 'Merengue',
  143: 'Salsa',
  144: 'Thrash Metal',
  145: 'Anime',
  146: 'JPop',
  147: 'Synthpop',
};

export function lookupId3v1Genre(code: number): string | undefined {
  return ID3V1_GENRES[code];
}

export function cleanRawGenreTag(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Handle ID3v2 numeric references like "(17)" or "(17)Rock" or bare "17"
  const parenMatch = trimmed.match(/^\((\d{1,3})\)\s*(.*)$/);
  if (parenMatch) {
    const trailing = parenMatch[2].trim();
    if (trailing) return trailing;
    const mapped = ID3V1_GENRES[parseInt(parenMatch[1], 10)];
    return mapped ?? '';
  }
  if (/^\d{1,3}$/.test(trimmed)) {
    return ID3V1_GENRES[parseInt(trimmed, 10)] ?? '';
  }
  return trimmed;
}

interface GenreRule {
  genre: string;
  patterns: RegExp[];
}

const CANONICAL_GENRE_RULES: GenreRule[] = [
  {
    genre: 'Electronic',
    patterns: [
      /\b(electronic|electronica|edm|house|deep house|tech house|progressive house|afro house|melodic techno|techno|trance|psytrance|dubstep|drum\s*&?\s*bass|dnb|liquid dnb|synthwave|retrowave|vaporwave|future funk|electro|idm|breakbeat|uk garage|2-step|future bass|hardstyle|gabber|rave|club mix|club edit|eurodance|acid|jungle|goa|chiptune|cyberpunk|original mix|extended mix|vip mix|club|dub mix|radio mix|bootleg|mashup|remix|dj\b|\b1[1-4]\d\s*bpm\b)/i,
    ],
  },
  {
    genre: 'Hip-Hop / Rap',
    patterns: [
      /\b(hip[\s-]?hop|rap|trap|drill|uk drill|boom\s?bap|mixtape|cypher|freestyle|gangsta|grime|phonk|cloud rap|mumble rap|west coast|east coast|g-funk|beat tape|type beat|instrumental beat|prod\.|mc\b)/i,
    ],
  },
  {
    genre: 'Ambient / Lo-Fi',
    patterns: [
      /\b(lo[\s-]?fi|lofi|ambient|chillhop|chillout|chill[\s-]?wave|chill|downtempo|trip[\s-]?hop|soundscape|meditation|meditative|sleep|study beats|study music|drone|atmospheric|new age|relaxing|spa|rain sounds|binaural|dark ambient|space music)/i,
    ],
  },
  {
    genre: 'Metal',
    patterns: [
      /\b(metal|heavy metal|death metal|black metal|thrash|metalcore|deathcore|doom metal|nu[\s-]?metal|djent|prog metal|power metal|symphonic metal|sludge|stoner metal|grindcore|speed metal)/i,
    ],
  },
  {
    genre: 'Punk / Hardcore',
    patterns: [
      /\b(punk|punk rock|pop punk|hardcore|hardcore punk|post[\s-]?hardcore|skate punk|crust punk|emo|screamo|midwest emo|melodic hardcore|ska punk)/i,
    ],
  },
  {
    genre: 'Indie / Alternative',
    patterns: [
      /\b(indie|alternative|alt[\s-]?rock|alt[\s-]?pop|shoegaze|dream\s?pop|bedroom\s?pop|post[\s-]?punk|new\s?wave|darkwave|coldwave|britpop|math\s?rock|art\s?rock|grunge|post[\s-]?rock|lo-fi indie|chamber pop)/i,
    ],
  },
  {
    genre: 'Rock',
    patterns: [
      /\b(rock|classic rock|hard rock|garage rock|prog rock|progressive rock|psychedelic|southern rock|blues rock|rock\s*&\s*roll|arena rock|soft rock|glam rock|stoner rock|krautrock|guitar solo)/i,
    ],
  },
  {
    genre: 'Funk / Disco',
    patterns: [
      /\b(funk|disco|nu[\s-]?disco|boogie|p[\s-]?funk|electro[\s-]?funk|italo[\s-]?disco|french touch|groove)/i,
    ],
  },
  {
    genre: 'R&B / Soul',
    patterns: [
      /\b(r&b|rnb|rhythm\s*&?\s*blues|soul|neo[\s-]?soul|motown|gospel|quiet storm|slow jam|contemporary r&b|alt r&b)/i,
    ],
  },
  {
    genre: 'Blues',
    patterns: [
      /\b(blues|delta blues|chicago blues|electric blues|acoustic blues|rhythm blues|blue note|slide guitar)/i,
    ],
  },
  {
    genre: 'Jazz',
    patterns: [
      /\b(jazz|bebop|hard bop|swing|bossa\s?nova|fusion|smooth jazz|acid jazz|nu[\s-]?jazz|big band|saxophone|sax\b|jazz trio|quartet|quintet|sextet|modal jazz|cool jazz|gypsy jazz)/i,
    ],
  },
  {
    genre: 'Classical',
    patterns: [
      /\b(classical|symphony|concerto|sonata|prelude|nocturne|etude|étude|adagio|allegro|andante|orchestra|orchestral|philharmonic|chamber music|string quartet|violin concerto|cello suite|piano solo|baroque|opera|waltz|requiem|cantata|fugue|aria|op\.\s*\d+|bwv\s*\d+|k\.\s*\d+)/i,
    ],
  },
  {
    genre: 'Pop',
    patterns: [
      /\b(pop|dance[\s-]?pop|synth[\s-]?pop|k[\s-]?pop|j[\s-]?pop|electropop|hyperpop|top\s*40|vocal pop|teen pop|europop|mandopop|cantopop|city pop|a cappella|ballad|radio edit)/i,
    ],
  },
  {
    genre: 'Country / Folk',
    patterns: [
      /\b(country|folk|americana|bluegrass|singer[\s-]?songwriter|western|celtic|banjo|nashville|outlaw country|alt[\s-]?country|indie folk|folk rock)/i,
    ],
  },
  {
    genre: 'Latin / Afrobeats',
    patterns: [
      /\b(latin|reggaeton|salsa|bachata|cumbia|merengue|tango|samba|flamenco|mariachi|corrido|bossa|mpb|afrobeat|afrobeats|amapiano|highlife|kizomba)/i,
    ],
  },
  {
    genre: 'Reggae / Dub',
    patterns: [
      /\b(reggae|roots reggae|dub\b|ska\b|rocksteady|dancehall|ragga|lovers rock)/i,
    ],
  },
  {
    genre: 'World / Global',
    patterns: [
      /\b(world music|ethnic|traditional|bollywood|bhangra|qawwali|arabic|gnawa|klezmer|taiko|gamelan|nordic folk|mediterranean|middle eastern|carnatic|hindustani)/i,
    ],
  },
  {
    genre: 'Soundtrack / Score',
    patterns: [
      /\b(soundtrack|ost\b|bgm\b|original score|film score|movie score|main theme|main title|end credits|opening theme|ending theme|anime|video game|game music|cinematic|trailer|overture|suite|showtunes|musical)/i,
    ],
  },
  {
    genre: 'Acoustic / Instrumental',
    patterns: [
      /\b(acoustic|unplugged|instrumental|piano cover|guitar cover|fingerstyle|solo piano|solo guitar|live session|live at)/i,
    ],
  },
  {
    genre: 'Podcast / Spoken',
    patterns: [
      /\b(podcast|episode|ep\.\s*\d+|audiobook|interview|lecture|spoken word|speech|voice memo|talk show|commentary|narration|stand[\s-]?up|comedy)/i,
    ],
  },
];

export interface InferredGenreResult {
  genre: string;
  source: 'tag' | 'inferred' | 'unclassified';
  /** Optional hint explaining how an inferred genre was resolved */
  reason?: 'keyword' | 'album' | 'artist' | 'folder' | 'duration';
}

function matchCanonicalGenre(text: string): string | null {
  for (const rule of CANONICAL_GENRE_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return rule.genre;
      }
    }
  }
  return null;
}

const GENERIC_GENRE_TAGS = new Set([
  'other',
  'unknown',
  'none',
  'n/a',
  'untagged',
  'unclassified',
]);

const KNOWN_ARTIST_GENRE_GROUPS: Array<[string, string[]]> = [
  [
    'Electronic',
    [
      'daft punk', 'deadmau5', 'skrillex', 'calvin harris', 'avicii', 'disclosure', 'flume',
      'odesza', 'aphex twin', 'boards of canada', 'four tet', 'bicep', 'jamie xx', 'fred again',
      'fred again..', 'martin garrix', 'tiesto', 'armin van buuren', 'david guetta', 'zedd',
      'kygo', 'marshmello', 'illenium', 'porter robinson', 'madeon', 'fisher', 'peggy gou',
      'rufus du sol', 'lane 8', 'ben bohmer', 'anyma', 'tale of us', 'charlotte de witte',
      'amelie lens', 'carl cox', 'nina kraviz', 'sub focus', 'pendulum', 'chase & status',
      'noisia', 'the prodigy', 'the chemical brothers', 'fatboy slim', 'justice', 'gesaffelstein',
      'kavinsky', 'carpenter brut', 'perturbator', 'the midnight', 'gunship', 'timecop1983',
      'bonobo', 'caribou', 'floating points', 'overmono', 'skream', 'burial', 'diplo',
      'major lazer', 'swedish house mafia', 'alesso', 'eric prydz', 'solomun', 'black coffee',
      'kaytranada', 'moby', 'underworld', 'orbital', 'kraftwerk', 'jean-michel jarre',
      'todd terje', 'royskopp', 'chromeo', 'parcels', 'zeds dead', 'reZZ', 'rezz', 'excision',
      'galantis', 'clean bandit', 'alan walker', 'kshmr', 'hardwell', 'afrojack', 'steve aoki',
    ],
  ],
  [
    'Hip-Hop / Rap',
    [
      'kendrick lamar', 'drake', 'kanye west', 'ye', 'travis scott', 'j. cole', 'j cole',
      'eminem', '2pac', 'tupac', 'the notorious b.i.g.', 'notorious b.i.g.', 'biggie', 'nas',
      'outkast', 'jay-z', 'jay z', 'tyler, the creator', 'tyler the creator', 'playboi carti',
      'metro boomin', 'future', '21 savage', 'lil wayne', 'snoop dogg', 'dr. dre', 'dr dre',
      '50 cent', 'post malone', 'doja cat', 'a$ap rocky', 'asap rocky', 'kid cudi', 'lil uzi vert',
      'juice wrld', 'xxxtentacion', 'pop smoke', 'lil baby', 'gunna', 'young thug', 'migos',
      'nicki minaj', 'cardi b', 'megan thee stallion', 'ice spice', 'missy elliott',
      'beastie boys', 'public enemy', 'n.w.a', 'ice cube', 'cypress hill', 'mf doom', 'madvillain',
      'a tribe called quest', 'wu-tang clan', 'run the jewels', 'mac miller', 'childish gambino',
      'freddie gibbs', 'pusha t', 'danny brown', 'jpegmafia', 'little simz', 'stormzy', 'dave',
      'central cee', 'skepta', 'j dilla', 'nujabes', 'logic', 'nf', 'jack harlow', 'don toliver',
      'baby keem', 'joey bada$$', 'denzel curry', 'jid', 'earl sweatshirt', 'vince staples',
      'schoolboy q', 'wiz khalifa', 'meek mill', 'rick ross', 'gucci mane', 'kodak black',
      'roddy ricch', 'dababy', 'lil nas x', 'yeat', 'ken carson', 'destroy lonely', 'pitbull',
      'flo rida', 'macklemore', 'black eyed peas', 'lauryn hill', 'fugees', 'de la soul',
      'rakim', 'big l', 'mobb deep', 'bone thugs-n-harmony', 'ludacris', 't.i.', 'nelly',
    ],
  ],
  [
    'Pop',
    [
      'taylor swift', 'billie eilish', 'dua lipa', 'ed sheeran', 'ariana grande', 'harry styles',
      'justin bieber', 'olivia rodrigo', 'sabrina carpenter', 'chappell roan', 'charli xcx',
      'katy perry', 'lady gaga', 'rihanna', 'beyonce', 'bruno mars', 'adele', 'sia', 'lorde',
      'shawn mendes', 'charlie puth', 'camila cabello', 'selena gomez', 'miley cyrus',
      'demi lovato', 'sam smith', 'lewis capaldi', 'michael jackson', 'madonna', 'prince',
      'whitney houston', 'mariah carey', 'celine dion', 'britney spears', 'christina aguilera',
      'justin timberlake', 'maroon 5', 'onerepublic', 'imagine dragons', 'coldplay',
      'bts', 'blackpink', 'newjeans', 'stray kids', 'twice', 'seventeen', 'exo', 'aespa',
      'le sserafim', 'ive', 'jung kook', 'yoasobi', 'ado', 'kenshi yonezu', 'fujii kaze',
      'abba', 'elton john', 'george michael', 'wham!', 'cyndi lauper', 'robbie williams',
      'kylie minogue', 'carly rae jepsen', 'troye sivan', 'conan gray', 'tate mcrae',
      'gracie abrams', 'benson boone', 'teddy swims', 'pink', 'p!nk', 'avril lavigne',
      'kelly clarkson', 'kesha', 'ellie goulding', 'halsey', 'zara larsson', 'bebe rexha',
      'ava max', 'anne-marie', 'meghan trainor', 'lizzo', 'jonas brothers', 'one direction',
    ],
  ],
  [
    'R&B / Soul',
    [
      'the weeknd', 'frank ocean', 'sza', 'daniel caesar', 'brent faiyaz', 'giveon',
      'summer walker', 'h.e.r.', 'khalid', 'usher', 'alicia keys', 'chris brown',
      'erykah badu', 'dangelo', "d'angelo", 'stevie wonder', 'marvin gaye', 'aretha franklin',
      'otis redding', 'sam cooke', 'al green', 'bill withers', 'ray charles', 'amy winehouse',
      'anderson .paak', 'anderson paak', 'silk sonic', 'john legend', 'miguel', 'bryson tiller',
      'partynextdoor', 'tory lanez', 'jhene aiko', 'kehlani', 'victoria monet', 'kali uchis',
      'solange', 'janelle monae', 'jorja smith', 'cleo sol', 'sault', 'sampha', 'blood orange',
      'steve lacy', 'omar apollo', 'pinkpantheress', 'tinashe', 'ciara', 'aaliyah', 'tlc',
      'destinys child', "destiny's child", 'boyz ii men', 'ne-yo', 'trey songz', 'mary j. blige',
      'sade', 'maxwell', 'anita baker', 'luther vandross', 'leon bridges', 'michael kiwanuka',
    ],
  ],
  [
    'Rock',
    [
      'the beatles', 'beatles', 'pink floyd', 'queen', 'led zeppelin', 'the rolling stones',
      'rolling stones', 'ac/dc', 'acdc', 'fleetwood mac', 'nirvana', 'foo fighters',
      'red hot chili peppers', 'david bowie', 'jimi hendrix', 'the doors', 'eagles',
      'dire straits', 'u2', 'aerosmith', 'guns n roses', "guns n' roses", 'van halen',
      'bon jovi', 'def leppard', 'journey', 'toto', 'steely dan', 'santana', 'bruce springsteen',
      'tom petty', 'billy joel', 'bob seger', 'creedence clearwater revival', 'lynyrd skynyrd',
      'the who', 'deep purple', 'rush', 'yes', 'genesis', 'king crimson', 'supertramp',
      'boston', 'kansas', 'foreigner', 'heart', 'blondie', 'the police', 'sting', 'phil collins',
      'pearl jam', 'soundgarden', 'alice in chains', 'stone temple pilots', 'smashing pumpkins',
      'muse', 'oasis', 'blur', 'the killers', 'linkin park', 'nickelback', 'creed',
      'three days grace', 'breaking benjamin', 'shinedown', 'queens of the stone age',
      'royal blood', 'greta van fleet', 'maneskin', 'the black keys', 'white stripes',
      'the white stripes', 'jack white', 'kings of leon', 'audisolve', 'audioslave',
      'rage against the machine', 'incubus', '3 doors down', 'matchbox twenty', 'goo goo dolls',
    ],
  ],
  [
    'Indie / Alternative',
    [
      'radiohead', 'arctic monkeys', 'tame impala', 'the strokes', 'vampire weekend',
      'mac demarco', 'cigarettes after sex', 'beach house', 'mitski', 'clairo', 'lana del rey',
      'the smiths', 'the cure', 'depeche mode', 'joy division', 'new order', 'talking heads',
      'gorillaz', 'r.e.m.', 'rem', 'pixies', 'sonic youth', 'my bloody valentine', 'slowdive',
      'cocteau twins', 'pavement', 'modest mouse', 'arcade fire', 'interpol', 'the national',
      'bon iver', 'phoebe bridgers', 'boygenius', 'fleet foxes', 'grizzly bear', 'animal collective',
      'mgmt', 'phoenix', 'two door cinema club', 'foster the people', 'cage the elephant',
      'glass animals', 'alt-j', 'the 1975', 'the neighbourhood', 'twenty one pilots',
      'weezer', 'beck', 'flaming lips', 'wilco', 'spoon', 'death cab for cutie', 'the shins',
      'sufjan stevens', 'elliott smith', 'tv girl', 'men i trust', 'khruangbin', 'king gizzard',
      'fontaines d.c.', 'idles', 'wet leg', 'beabadoobee', 'faye webster', 'alex g',
      'alvvays', 'japanese breakfast', 'soccer mommy', 'snail mail', 'wolf alice', 'foals',
      'bastille', 'vampire weekend', 'franz ferdinand', 'kasabian', 'the kooks', 'the libertines',
      'bjork', 'fka twigs', 'st. vincent', 'mitski', 'st. paul', 'sigur ros', 'mogwai',
      'explosions in the sky', 'godspeed you! black emperor', 'nine inch nails', 'massive attack',
      'portishead',
    ],
  ],
  [
    'Metal',
    [
      'metallica', 'iron maiden', 'black sabbath', 'megadeth', 'slayer', 'anthrax',
      'judas priest', 'motorhead', 'ozzy osbourne', 'pantera', 'system of a down', 'tool',
      'slipknot', 'korn', 'deftones', 'avenged sevenfold', 'rammstein', 'gojira', 'mastodon',
      'opeth', 'dream theater', 'meshuggah', 'lamb of god', 'trivium', 'bullet for my valentine',
      'bring me the horizon', 'architects', 'spiritbox', 'sleep token', 'bad omens',
      'ghost', 'disturbed', 'five finger death punch', 'sabaton', 'nightwish', 'epica',
      'in flames', 'children of bodom', 'amon amarth', 'behemoth', 'death', 'sepultura',
      'dio', 'alice cooper', 'marilyn manson', 'rob zombie', 'killswitch engage', 'parkway drive',
    ],
  ],
  [
    'Punk / Hardcore',
    [
      'green day', 'blink-182', 'blink 182', 'paramore', 'my chemical romance', 'fall out boy',
      'panic! at the disco', 'the offspring', 'sum 41', 'good charlotte', 'simple plan',
      'ramones', 'the clash', 'sex pistols', 'dead kennedys', 'black flag', 'bad religion',
      'nofx', 'rancid', 'rise against', 'pennywise', 'misfits', 'fugazi', 'minor threat',
      'turnstile', 'knocked loose', 'a day to remember', 'pierce the veil', 'sleeping with sirens',
      'all time low', 'jimmy eat world', 'taking back sunday', 'brand new', 'neck deep',
      'the story so far', 'machine gun kelly', 'yungblud', 'avril lavigne', 'idles',
    ],
  ],
  [
    'Funk / Disco',
    [
      'earth, wind & fire', 'earth wind & fire', 'chic', 'bee gees', 'kool & the gang',
      'donna summer', 'james brown', 'parliament', 'funkadelic', 'sly & the family stone',
      'vulfpeck', 'cory wong', 'thundercat', 'jamiroquai', 'kc and the sunshine band',
      'gloria gaynor', 'diana ross', 'sister sledge', 'village people', 'boney m',
      'rick james', 'chaka khan', 'commodores', 'the isley brothers', 'bootsy collins',
      'tower of power', 'average white band', 'herbie hancock', 'louis cole', 'knower',
    ],
  ],
  [
    'Jazz',
    [
      'miles davis', 'john coltrane', 'bill evans', 'chet baker', 'thelonious monk',
      'charles mingus', 'charlie parker', 'dizzy gillespie', 'duke ellington', 'count basie',
      'louis armstrong', 'ella fitzgerald', 'billie holiday', 'nina simone', 'sarah vaughan',
      'frank sinatra', 'nat king cole', 'tony bennett', 'dave brubeck', 'stan getz',
      'art blakey', 'wayne shorter', 'sonny rollins', 'oscar peterson', 'keith jarrett',
      'pat metheny', 'wes montgomery', 'grant green', 'ahmad jamal', 'horace silver',
      'cannonball adderley', 'freddie hubbard', 'kamasi washington', 'robert glasper',
      'badbadnotgood', 'snarky puppy', 'hiromi', 'esperanza spalding', 'laufey', 'norah jones',
      'diana krall', 'michael buble', 'jamie cullum', 'yussef dayes', 'ezra collective',
      'alfa mist', 'goGo penguin', 'gogo penguin',
    ],
  ],
  [
    'Blues',
    [
      'b.b. king', 'bb king', 'stevie ray vaughan', 'muddy waters', 'robert johnson',
      'howlin wolf', "howlin' wolf", 'john lee hooker', 'albert king', 'freddie king',
      'buddy guy', 'eric clapton', 'gary moore', 'joe bonamassa', 'christone kingfish ingram',
      'gary clark jr', 'gary clark jr.', 'etta james', 'bessie smith', 'lead belly',
      't-bone walker', 'elmore james', 'johnny winter', 'rory gallagher', 'derek and the dominos',
      'john mayer',
    ],
  ],
  [
    'Classical',
    [
      'mozart', 'wolfgang amadeus mozart', 'beethoven', 'ludwig van beethoven', 'bach',
      'johann sebastian bach', 'chopin', 'frederic chopin', 'vivaldi', 'antonio vivaldi',
      'debussy', 'claude debussy', 'ravel', 'maurice ravel', 'tchaikovsky', 'pyotr ilyich tchaikovsky',
      'brahms', 'johannes brahms', 'schubert', 'franz schubert', 'schumann', 'liszt', 'franz liszt',
      'rachmaninoff', 'sergei rachmaninoff', 'mahler', 'gustav mahler', 'stravinsky',
      'shostakovich', 'prokofiev', 'erik satie', 'satie', 'handel', 'haydn', 'mendelssohn',
      'dvorak', 'antonin dvorak', 'grieg', 'edvard grieg', 'sibelius', 'paganini', 'verdi',
      'puccini', 'wagner', 'ludovico einaudi', 'max richter', 'olafur arnalds', 'nils frahm',
      'yann tiersen', 'yo-yo ma', 'lang lang', 'yuja wang', 'hilary hahn', 'itzhak perlman',
      'glenn gould', 'martha argerich', 'arvo part', 'philip glass', 'steve reich',
    ],
  ],
  [
    'Country / Folk',
    [
      'johnny cash', 'dolly parton', 'willie nelson', 'waylon jennings', 'merle haggard',
      'hank williams', 'george strait', 'garth brooks', 'alan jackson', 'shania twain',
      'tim mcgraw', 'faith hill', 'keith urban', 'carrie underwood', 'miranda lambert',
      'chris stapleton', 'zach bryan', 'morgan wallen', 'luke combs', 'tyler childers',
      'sturgill simpson', 'kacey musgraves', 'jason isbell', 'brandi carlile', 'colter wall',
      'lainey wilson', 'jelly roll', 'kane brown', 'thomas rhett', 'eric church', 'zac brown band',
      'bob dylan', 'neil young', 'joni mitchell', 'simon & garfunkel', 'nick drake',
      'cat stevens', 'yusuf', 'james taylor', 'tracy chapman', 'john denver', 'gordon lightfoot',
      'leonard cohen', 'hozier', 'noah kahan', 'mumford & sons', 'the lumineers', 'vance joy',
      'of monsters and men', 'iron & wine', 'gregory alan isakov', 'lord huron', 'caamp',
      'jack johnson', 'ben howard', 'damien rice', 'jose gonzalez', 'first aid kit',
    ],
  ],
  [
    'Latin / Afrobeats',
    [
      'bad bunny', 'j balvin', 'maluma', 'ozuna', 'daddy yankee', 'karol g', 'rosalia',
      'shakira', 'rauw alejandro', 'feid', 'peso pluma', 'fuerza regida', 'grupo frontera',
      'junior h', 'natanael cano', 'anuel aa', 'nicky jam', 'farruko', 'myke towers',
      'bizarrap', 'quevedo', 'becky g', 'anitta', 'luis fonsi', 'enrique iglesias', 'marc anthony',
      'romeo santos', 'aventura', 'juanes', 'maná', 'mana', 'soda stereo', 'luis miguel',
      'selena', 'celia cruz', 'hector lavoe', 'buena vista social club', 'antonio carlos jobim',
      'joao gilberto', 'astrud gilberto', 'burna boy', 'wizkid', 'davido', 'tems', 'rema',
      'asake', 'ayra starr', 'ckay', 'fireboy dml', 'omah lay', 'fela kuti', 'tyla',
    ],
  ],
  [
    'Reggae / Dub',
    [
      'bob marley', 'bob marley & the wailers', 'peter tosh', 'jimmy cliff', 'toots & the maytals',
      'damian marley', 'stephen marley', 'ziggy marley', 'chronixx', 'protoje', 'koffee',
      'shaggy', 'sean paul', 'vybz kartel', 'buju banton', 'beenie man', 'sizzla', 'barrington levy',
      'dennis brown', 'gregory isaacs', 'lee scratch perry', 'king tubby', 'augustus pablo',
      'ub40', 'sublime', 'slightly stoopid', 'stick figure', 'rebelution', 'steel pulse',
    ],
  ],
  [
    'Ambient / Lo-Fi',
    [
      'brian eno', 'tycho', 'lofi girl', 'chilledcow', 'jinsang', 'kupla', 'idealism',
      'eevee', 'potsu', 'swum', 'bsd.u', 'stars of the lid', 'william basinski', 'grouper',
      'tim hecker', 'eluvium', 'harold budd', 'steve roach', 'carbon based lifeforms',
      'hammock', 'biosphere', 'kiasmos', 'rival consoles', 'jon hopkins', 'emancipator',
    ],
  ],
  [
    'Soundtrack / Score',
    [
      'hans zimmer', 'john williams', 'ennio morricone', 'joe hisaishi', 'howard shore',
      'ramin djawadi', 'ludwig goransson', 'alexandre desplat', 'thomas newman', 'james horner',
      'alan silvestri', 'danny elfman', 'michael giacchino', 'james newton howard',
      'trent reznor and atticus ross', 'justin hurwitz', 'nicholas britell', 'john powell',
      'c418', 'koji kondo', 'nobuo uematsu', 'toby fox', 'yoko shimomura', 'jeremy soule',
      'mick gordon', 'darren korb', 'lena raine', 'christopher larkin', 'hiroyuki sawano',
      'yoko kanno', 'shiro sagisu', 'yasuharu takanashi', 'two steps from hell',
    ],
  ],
  [
    'World / Global',
    [
      'a.r. rahman', 'ar rahman', 'arijit singh', 'shreya ghoshal', 'diljit dosanjh',
      'nusrat fateh ali khan', 'ravi shankar', 'anoushka shankar', 'ali farka toure',
      'tinariwen', 'mory kante', 'youssou ndour', 'cesaria evora', 'umm kulthum', 'fairuz',
      'amr diab', 'stromae', 'indila', 'edith piaf', 'zaz', 'paco de lucia', 'gipsy kings',
      'heilung', 'wardruna', 'eivør', 'eivor', 'hu', 'the hu',
    ],
  ],
];

const KNOWN_ARTIST_GENRE_MAP: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [genre, artists] of KNOWN_ARTIST_GENRE_GROUPS) {
    for (const artist of artists) {
      map.set(normalizeArtistLookupKey(artist), genre);
    }
  }
  return map;
})();

function normalizeArtistLookupKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lookupArtistCandidates(rawText: string): string | null {
  if (!rawText) return null;
  const cleaned = rawText.trim();
  if (!cleaned || cleaned.toLowerCase() === 'unknown artist') return null;

  const direct = KNOWN_ARTIST_GENRE_MAP.get(normalizeArtistLookupKey(cleaned));
  if (direct) return direct;

  // Split collaborations: "Artist feat. X", "Artist ft. Y", "Artist & Z", "Artist, W", "Artist x V"
  const parts = cleaned
    .split(/\s+(?:feat\.?|ft\.?|featuring|with|vs\.?|x)\s+|[,;&/|]+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    const key = normalizeArtistLookupKey(part);
    const hit = KNOWN_ARTIST_GENRE_MAP.get(key);
    if (hit) return hit;
    if (key.startsWith('the ')) {
      const noThe = KNOWN_ARTIST_GENRE_MAP.get(key.slice(4));
      if (noThe) return noThe;
    }
  }

  return null;
}

function matchKnownArtistGenre(track: LocalTrack): string | null {
  // 1. Track artist metadata
  const fromArtist = lookupArtistCandidates(track.artist);
  if (fromArtist) return fromArtist;

  // 2. Parse "Artist - Title" or "01 - Artist - Title" from filename when artist tag is missing/unknown
  const baseName = track.fileName.replace(/\.[^.]+$/, '').replace(/^\d{1,3}\s*[-._)]\s*/, '');
  const dashSegments = baseName.split(/\s+[-–—]\s+/);
  if (dashSegments.length >= 2) {
    const fromFilePrefix = lookupArtistCandidates(dashSegments[0]);
    if (fromFilePrefix) return fromFilePrefix;
  }

  // 3. Check folder hierarchy (e.g. "Artist/Album/01 Track.flac")
  const relParts = (track.relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  for (let i = 0; i < Math.max(0, relParts.length - 1); i++) {
    const fromFolder = lookupArtistCandidates(relParts[i]);
    if (fromFolder) return fromFolder;
  }

  return null;
}

/**
 * Resolves a track's canonical music genre from:
 * 1) Embedded/edited genre metadata tag (`track.genre`), supporting multi-tag delimiters
 * 2) Known artist catalog lookup (metadata artist, filename prefix, or folder name)
 * 3) Folder & relative path keyword hints
 * 4) Artist, album, title, and filename keywords
 * 5) Duration heuristic for long-form spoken audio
 */
export function inferTrackGenre(track: LocalTrack): InferredGenreResult {
  // 1. Explicit embedded or user-edited genre tag
  if (track.genre) {
    const cleaned = cleanRawGenreTag(track.genre);
    if (cleaned && !GENERIC_GENRE_TAGS.has(cleaned.toLowerCase())) {
      const canonical = matchCanonicalGenre(cleaned);
      if (canonical) {
        return { genre: canonical, source: 'tag' };
      }
      // Split multi-genre tags (e.g. "Indie / Dream Pop", "House; Deep House", "Rock, Blues")
      const segments = cleaned
        .split(/[/;,|•]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !GENERIC_GENRE_TAGS.has(s.toLowerCase()));
      for (const seg of segments) {
        const segCanonical = matchCanonicalGenre(seg);
        if (segCanonical) {
          return { genre: segCanonical, source: 'tag' };
        }
      }
      const primary = segments[0] ?? cleaned;
      // Preserve clean custom/specific user genre tag in title case
      const titled = primary.replace(/\b\w/g, (c) => c.toUpperCase());
      return { genre: titled, source: 'tag' };
    }
  }

  // 2. Known artist recognition (instant zero-latency lookup)
  const fromKnownArtist = matchKnownArtistGenre(track);
  if (fromKnownArtist) {
    return { genre: fromKnownArtist, source: 'inferred', reason: 'artist' };
  }

  // 3. Folder & path cues (strong user organization signal)
  const pathContext = `${track.folderName} ${track.relativePath.replace(/[/\\_-]+/g, ' ')}`;
  const fromPath = matchCanonicalGenre(pathContext);
  if (fromPath) {
    return { genre: fromPath, source: 'inferred', reason: 'keyword' };
  }

  // 4. Artist, album, title, and filename cues
  const metaContext = [
    track.artist !== 'Unknown Artist' ? track.artist : '',
    track.album !== 'Unknown Album' ? track.album : '',
    track.title,
    track.fileName.replace(/[_.-]+/g, ' '),
  ]
    .filter(Boolean)
    .join(' ');

  const fromMeta = matchCanonicalGenre(metaContext);
  if (fromMeta) {
    return { genre: fromMeta, source: 'inferred', reason: 'keyword' };
  }

  // 5. Duration fallback for very long recordings (> 22 min)
  if (track.duration >= 22 * 60) {
    return { genre: 'Podcast / Spoken', source: 'inferred', reason: 'duration' };
  }

  return { genre: 'Unclassified', source: 'unclassified' };
}

function pickMajorityGenre(counts: Map<string, number>, minShare = 0.5): string | null {
  let total = 0;
  let bestGenre: string | null = null;
  let bestCount = 0;
  for (const [genre, count] of counts.entries()) {
    total += count;
    if (count > bestCount) {
      bestCount = count;
      bestGenre = genre;
    }
  }
  if (!bestGenre || total === 0) return null;
  return bestCount / total >= minShare ? bestGenre : null;
}

function getParentFolderKey(track: LocalTrack): string {
  const normalized = (track.relativePath || '').replace(/\\/g, '/');
  const slashIdx = normalized.lastIndexOf('/');
  if (slashIdx > 0) {
    return normalized.slice(0, slashIdx).toLowerCase();
  }
  return (track.folderName || '').trim().toLowerCase();
}

/**
 * Resolves genres across the full library using a two-pass strategy:
 * - Pass 1: Direct embedded tag + keyword/path inference per track
 * - Pass 2: Propagates majority-vote genre consensus from sibling tracks
 *   sharing the same album, artist, or subfolder to dramatically reduce
 *   false Unclassified / Other buckets.
 */
export function inferLibraryGenreMap(tracks: LocalTrack[]): Map<string, InferredGenreResult> {
  const resultMap = new Map<string, InferredGenreResult>();
  if (tracks.length === 0) return resultMap;

  const albumVotes = new Map<string, Map<string, number>>();
  const artistVotes = new Map<string, Map<string, number>>();
  const folderVotes = new Map<string, Map<string, number>>();

  const addVote = (bucketMap: Map<string, Map<string, number>>, key: string, genre: string) => {
    if (!key) return;
    let inner = bucketMap.get(key);
    if (!inner) {
      inner = new Map<string, number>();
      bucketMap.set(key, inner);
    }
    inner.set(genre, (inner.get(genre) ?? 0) + 1);
  };

  for (const track of tracks) {
    const firstPass = inferTrackGenre(track);
    resultMap.set(track.id, firstPass);

    if (firstPass.source !== 'unclassified') {
      const artistNorm =
        track.artist && track.artist !== 'Unknown Artist' ? track.artist.trim().toLowerCase() : '';
      const albumNorm =
        track.album && track.album !== 'Unknown Album' ? track.album.trim().toLowerCase() : '';
      const folderNorm = getParentFolderKey(track);

      if (albumNorm) {
        addVote(albumVotes, `${artistNorm}::${albumNorm}`, firstPass.genre);
      }
      if (artistNorm) {
        addVote(artistVotes, artistNorm, firstPass.genre);
      }
      if (folderNorm && folderNorm !== 'music' && folderNorm !== 'downloads') {
        addVote(folderVotes, folderNorm, firstPass.genre);
      }
    }
  }

  // Pass 2: Infer remaining Unclassified tracks via Album -> Artist -> Folder consensus
  for (const track of tracks) {
    const existing = resultMap.get(track.id);
    if (!existing || existing.source !== 'unclassified') continue;

    const artistNorm =
      track.artist && track.artist !== 'Unknown Artist' ? track.artist.trim().toLowerCase() : '';
    const albumNorm =
      track.album && track.album !== 'Unknown Album' ? track.album.trim().toLowerCase() : '';
    const folderNorm = getParentFolderKey(track);

    if (albumNorm) {
      const albumWinner = pickMajorityGenre(
        albumVotes.get(`${artistNorm}::${albumNorm}`) ?? new Map(),
        0.5
      );
      if (albumWinner) {
        resultMap.set(track.id, { genre: albumWinner, source: 'inferred', reason: 'album' });
        continue;
      }
    }

    if (artistNorm) {
      const artistWinner = pickMajorityGenre(artistVotes.get(artistNorm) ?? new Map(), 0.5);
      if (artistWinner) {
        resultMap.set(track.id, { genre: artistWinner, source: 'inferred', reason: 'artist' });
        continue;
      }
    }

    if (folderNorm && folderNorm !== 'music' && folderNorm !== 'downloads') {
      const folderWinner = pickMajorityGenre(folderVotes.get(folderNorm) ?? new Map(), 0.6);
      if (folderWinner) {
        resultMap.set(track.id, { genre: folderWinner, source: 'inferred', reason: 'folder' });
      }
    }
  }

  return resultMap;
}

export interface GenreGroupSummary {
  genre: string;
  tracks: LocalTrack[];
  trackIds: string[];
  count: number;
  sharePct: number;
  totalDuration: number;
  avgDuration: number;
  totalSize: number;
  avgBitrateKbps: number | null;
  matchedCount: number;
  taggedCount: number;
}

export interface DurationBucket {
  label: string;
  count: number;
  pct: number;
}

export interface FormatSummary {
  format: string;
  count: number;
  size: number;
  pct: number;
}

export interface TrackStatistics {
  totalTracks: number;
  activeTracks: number;
  missingTracks: number;
  matchedTracks: number;
  unmatchedTracks: number;
  skippedTracks: number;
  matchRatePct: number;
  totalDuration: number;
  avgDuration: number;
  longestTrack: LocalTrack | null;
  shortestTrack: LocalTrack | null;
  totalSize: number;
  avgSize: number;
  avgBitrateKbps: number | null;
  losslessCount: number;
  losslessPct: number;
  uniqueArtists: number;
  uniqueAlbums: number;
  uniqueFolders: number;
  uniqueGenres: number;
  withCoverArtCount: number;
  withYearCount: number;
  withEmbeddedGenreCount: number;
  yearRange: { min: number; max: number } | null;
  durationBuckets: DurationBucket[];
  formats: FormatSummary[];
  genreGroups: GenreGroupSummary[];
  /** Library-aware genre resolution map (includes album/artist/folder consensus) */
  trackGenreMap: Map<string, InferredGenreResult>;
}

const LOSSLESS_FORMATS = new Set(['FLAC', 'WAV', 'AIFF', 'AIF', 'AIFC', 'ALAC']);

export function computeTrackBitrateKbps(track: LocalTrack): number | null {
  if (!track.fileSize || track.fileSize <= 0 || !track.duration || track.duration <= 0) {
    return null;
  }
  const kbps = Math.round((track.fileSize * 8) / (track.duration * 1000));
  // Filter unrealistic outlier values (e.g. corrupt header or tiny placeholder)
  if (kbps < 16 || kbps > 10000) return null;
  return kbps;
}

export function computeTrackStatistics(tracks: LocalTrack[]): TrackStatistics {
  let activeTracks = 0;
  let missingTracks = 0;
  let matchedTracks = 0;
  let unmatchedTracks = 0;
  let skippedTracks = 0;
  let totalDuration = 0;
  let durationKnownCount = 0;
  let totalSize = 0;
  let sizeKnownCount = 0;
  let bitrateSum = 0;
  let bitrateCount = 0;
  let losslessCount = 0;
  let withCoverArtCount = 0;
  let withYearCount = 0;
  let withEmbeddedGenreCount = 0;

  let longestTrack: LocalTrack | null = null;
  let shortestTrack: LocalTrack | null = null;

  let minYear = Infinity;
  let maxYear = -Infinity;

  const artists = new Set<string>();
  const albums = new Set<string>();
  const folders = new Set<string>();
  const formatTotals = new Map<string, { count: number; size: number }>();

  const genreBuckets = new Map<
    string,
    {
      tracks: LocalTrack[];
      totalDuration: number;
      totalSize: number;
      bitrateSum: number;
      bitrateCount: number;
      matchedCount: number;
      taggedCount: number;
    }
  >();

  let under2m = 0;
  let twoTo4m = 0;
  let fourTo6m = 0;
  let over6m = 0;

  const trackGenreMap = inferLibraryGenreMap(tracks);

  for (const track of tracks) {
    if (track.isMissingOnDevice) missingTracks++;
    else activeTracks++;

    if (track.youtubeVideoId) matchedTracks++;
    else if (track.matchStatus === 'skipped') skippedTracks++;
    else unmatchedTracks++;

    if (track.duration > 0) {
      totalDuration += track.duration;
      durationKnownCount++;
      if (!longestTrack || track.duration > longestTrack.duration) {
        longestTrack = track;
      }
      if (!shortestTrack || track.duration < shortestTrack.duration) {
        shortestTrack = track;
      }
      if (track.duration < 120) under2m++;
      else if (track.duration < 240) twoTo4m++;
      else if (track.duration < 360) fourTo6m++;
      else over6m++;
    }

    if (track.fileSize > 0) {
      totalSize += track.fileSize;
      sizeKnownCount++;
    }

    const kbps = computeTrackBitrateKbps(track);
    if (kbps !== null) {
      bitrateSum += kbps;
      bitrateCount++;
    }

    const fmt = (track.format || 'AUDIO').toUpperCase();
    if (LOSSLESS_FORMATS.has(fmt)) losslessCount++;
    const fmtEntry = formatTotals.get(fmt) ?? { count: 0, size: 0 };
    fmtEntry.count += 1;
    fmtEntry.size += track.fileSize || 0;
    formatTotals.set(fmt, fmtEntry);

    if (track.artist && track.artist !== 'Unknown Artist') {
      artists.add(track.artist.toLowerCase());
    }
    if (track.album && track.album !== 'Unknown Album') {
      albums.add(track.album.toLowerCase());
    }
    if (track.folderName) {
      folders.add(track.folderName.toLowerCase());
    }
    if (track.coverArtUrl) withCoverArtCount++;

    const parsedYear = parseInt(track.year, 10);
    if (Number.isFinite(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100) {
      withYearCount++;
      if (parsedYear < minYear) minYear = parsedYear;
      if (parsedYear > maxYear) maxYear = parsedYear;
    }

    const inferred = trackGenreMap.get(track.id) ?? inferTrackGenre(track);
    if (inferred.source === 'tag') withEmbeddedGenreCount++;

    const gEntry = genreBuckets.get(inferred.genre) ?? {
      tracks: [],
      totalDuration: 0,
      totalSize: 0,
      bitrateSum: 0,
      bitrateCount: 0,
      matchedCount: 0,
      taggedCount: 0,
    };
    gEntry.tracks.push(track);
    gEntry.totalDuration += track.duration || 0;
    gEntry.totalSize += track.fileSize || 0;
    if (kbps !== null) {
      gEntry.bitrateSum += kbps;
      gEntry.bitrateCount++;
    }
    if (track.youtubeVideoId) gEntry.matchedCount++;
    if (inferred.source === 'tag') gEntry.taggedCount++;
    genreBuckets.set(inferred.genre, gEntry);
  }

  const totalTracks = tracks.length;
  const matchRatePct = totalTracks > 0 ? Math.round((matchedTracks / totalTracks) * 100) : 0;
  const avgDuration = durationKnownCount > 0 ? totalDuration / durationKnownCount : 0;
  const avgSize = sizeKnownCount > 0 ? totalSize / sizeKnownCount : 0;
  const avgBitrateKbps = bitrateCount > 0 ? Math.round(bitrateSum / bitrateCount) : null;
  const losslessPct = totalTracks > 0 ? Math.round((losslessCount / totalTracks) * 100) : 0;

  const bucketDenom = Math.max(1, durationKnownCount);
  const durationBuckets: DurationBucket[] = [
    { label: '< 2m', count: under2m, pct: Math.round((under2m / bucketDenom) * 100) },
    { label: '2–4m', count: twoTo4m, pct: Math.round((twoTo4m / bucketDenom) * 100) },
    { label: '4–6m', count: fourTo6m, pct: Math.round((fourTo6m / bucketDenom) * 100) },
    { label: '6m+', count: over6m, pct: Math.round((over6m / bucketDenom) * 100) },
  ];

  const formats: FormatSummary[] = Array.from(formatTotals.entries())
    .map(([format, data]) => ({
      format,
      count: data.count,
      size: data.size,
      pct: totalTracks > 0 ? Math.round((data.count / totalTracks) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const genreGroups: GenreGroupSummary[] = Array.from(genreBuckets.entries())
    .map(([genre, data]) => ({
      genre,
      tracks: data.tracks,
      trackIds: data.tracks.map((t) => t.id),
      count: data.tracks.length,
      sharePct: totalTracks > 0 ? Math.round((data.tracks.length / totalTracks) * 100) : 0,
      totalDuration: data.totalDuration,
      avgDuration: data.tracks.length > 0 ? data.totalDuration / data.tracks.length : 0,
      totalSize: data.totalSize,
      avgBitrateKbps:
        data.bitrateCount > 0 ? Math.round(data.bitrateSum / data.bitrateCount) : null,
      matchedCount: data.matchedCount,
      taggedCount: data.taggedCount,
    }))
    .sort((a, b) => {
      // Keep Unclassified at the bottom unless it's the only bucket
      if (a.genre === 'Unclassified' && b.genre !== 'Unclassified') return 1;
      if (b.genre === 'Unclassified' && a.genre !== 'Unclassified') return -1;
      return b.count - a.count || b.totalDuration - a.totalDuration;
    });

  const classifiedGenreCount = genreGroups.filter((g) => g.genre !== 'Unclassified').length;

  return {
    totalTracks,
    activeTracks,
    missingTracks,
    matchedTracks,
    unmatchedTracks,
    skippedTracks,
    matchRatePct,
    totalDuration,
    avgDuration,
    longestTrack,
    shortestTrack,
    totalSize,
    avgSize,
    avgBitrateKbps,
    losslessCount,
    losslessPct,
    uniqueArtists: artists.size,
    uniqueAlbums: albums.size,
    uniqueFolders: folders.size,
    uniqueGenres: classifiedGenreCount > 0 ? classifiedGenreCount : genreGroups.length,
    withCoverArtCount,
    withYearCount,
    withEmbeddedGenreCount,
    yearRange: minYear <= maxYear ? { min: minYear, max: maxYear } : null,
    durationBuckets,
    formats,
    genreGroups,
    trackGenreMap,
  };
}

export type DiversityProfileLabel =
  | 'No data'
  | 'Single-Genre'
  | 'Focused'
  | 'Moderate'
  | 'Balanced'
  | 'Eclectic';

export interface GenreDiversityInput {
  genre: string;
  weight: number;
}

export interface GenreDiversityMetrics {
  /** Number of non-zero genres evaluated */
  activeGenreCount: number;
  /** Simpson's Diversity Index (1 - sum(p_i^2)) expressed as 0..100% */
  simpsonIndexPct: number;
  /** Shannon effective number of genres (exp(H)), rounded to 1 decimal */
  effectiveGenreCount: number;
  /** Human-readable spread profile derived from Simpson's index */
  profileLabel: DiversityProfileLabel;
  /** Largest single genre and its exact rounded share */
  topGenre: { genre: string; sharePct: number } | null;
  /** Combined share percentage of the top 2 genres */
  topTwoSharePct: number;
  /** Number of genres representing under 10% share each */
  longTailCount: number;
}

/**
 * Computes transparent, mathematically grounded listening diversity metrics
 * (Simpson's Diversity Index & Shannon Effective Genre Count) for a weighted
 * genre distribution.
 */
export function computeGenreDiversity(
  items: GenreDiversityInput[]
): GenreDiversityMetrics {
  const positive = items.filter((item) => Number.isFinite(item.weight) && item.weight > 0);
  if (positive.length === 0) {
    return {
      activeGenreCount: 0,
      simpsonIndexPct: 0,
      effectiveGenreCount: 0,
      profileLabel: 'No data',
      topGenre: null,
      topTwoSharePct: 0,
      longTailCount: 0,
    };
  }

  // Prefer classified genres when available so unclassified files don't distort spread
  const classified = positive.filter(
    (item) => item.genre !== 'Unclassified' && item.genre !== 'Untagged'
  );
  const pool = classified.length > 0 ? classified : positive;
  const sorted = [...pool].sort((a, b) => b.weight - a.weight);
  const totalWeight = sorted.reduce((acc, item) => acc + item.weight, 0);

  if (totalWeight <= 0) {
    return {
      activeGenreCount: 0,
      simpsonIndexPct: 0,
      effectiveGenreCount: 0,
      profileLabel: 'No data',
      topGenre: null,
      topTwoSharePct: 0,
      longTailCount: 0,
    };
  }

  let sumSquares = 0;
  let shannonEntropy = 0;
  let longTailCount = 0;

  for (const item of sorted) {
    const p = item.weight / totalWeight;
    sumSquares += p * p;
    if (p > 0) {
      shannonEntropy -= p * Math.log(p);
    }
    if (p < 0.1) {
      longTailCount += 1;
    }
  }

  const simpson = Math.max(0, Math.min(1, 1 - sumSquares));
  const simpsonIndexPct = Math.round(simpson * 100);
  const effectiveGenreCount = Math.round(Math.exp(shannonEntropy) * 10) / 10;

  let profileLabel: DiversityProfileLabel;
  if (sorted.length <= 1) {
    profileLabel = 'Single-Genre';
  } else if (simpson < 0.35) {
    profileLabel = 'Focused';
  } else if (simpson < 0.6) {
    profileLabel = 'Moderate';
  } else if (simpson < 0.78) {
    profileLabel = 'Balanced';
  } else {
    profileLabel = 'Eclectic';
  }

  const top = sorted[0];
  const second = sorted[1];
  const topSharePct = Math.round((top.weight / totalWeight) * 100);
  const topTwoSharePct = Math.min(
    100,
    Math.round(((top.weight + (second ? second.weight : 0)) / totalWeight) * 100)
  );

  return {
    activeGenreCount: sorted.length,
    simpsonIndexPct,
    effectiveGenreCount,
    profileLabel,
    topGenre: { genre: top.genre, sharePct: topSharePct },
    topTwoSharePct,
    longTailCount,
  };
}

export type DeepBreakdownDimension = 'artist' | 'folder' | 'era' | 'format' | 'duration';

export interface DeepBreakdownSlice {
  key: string;
  label: string;
  count: number;
  sharePct: number;
  librarySharePct: number;
  totalDuration: number;
  playCount: number;
  matchedCount: number;
  trackIds: string[];
  sampleTitles: string[];
  isResidual?: boolean;
}

function resolveDeepBucketLabel(track: LocalTrack, dimension: DeepBreakdownDimension): string {
  switch (dimension) {
    case 'artist': {
      const a = (track.artist || '').trim();
      return a && a.toLowerCase() !== 'unknown artist' ? a : 'Unknown Artist';
    }
    case 'folder': {
      const rel = (track.relativePath || '').replace(/\\/g, '/');
      const parts = rel.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return parts[parts.length - 2];
      }
      const f = (track.folderName || '').trim();
      return f || 'Root Folder';
    }
    case 'era': {
      const y = parseInt(track.year || '', 10);
      if (!Number.isFinite(y) || y < 1900 || y > 2100) return 'No Year Tag';
      if (y >= 2020) return '2020s';
      if (y >= 2010) return '2010s';
      if (y >= 2000) return '2000s';
      if (y >= 1990) return '1990s';
      if (y >= 1980) return '1980s';
      return 'Pre-1980';
    }
    case 'format': {
      return (track.format || 'AUDIO').toUpperCase();
    }
    case 'duration': {
      if (!track.duration || track.duration <= 0) return 'Unknown Length';
      if (track.duration < 120) return 'Short Cuts (<2m)';
      if (track.duration < 240) return 'Standard (2–4m)';
      if (track.duration < 360) return 'Extended (4–6m)';
      return 'Long Tracks (6m+)';
    }
  }
}

/**
 * Breaks down a subset of tracks (e.g. Unclassified, Untagged, or raw Other)
 * along a structural dimension so users can inspect what's inside and batch-tag it.
 */
export function analyzeTrackBucket(
  bucketTracks: LocalTrack[],
  dimension: DeepBreakdownDimension,
  totalLibraryTracks: number,
  playCountLookup?: (track: LocalTrack) => number,
  maxSlices = 10
): DeepBreakdownSlice[] {
  if (bucketTracks.length === 0) return [];

  const groups = new Map<
    string,
    {
      tracks: LocalTrack[];
      totalDuration: number;
      playCount: number;
      matchedCount: number;
    }
  >();

  for (const track of bucketTracks) {
    const label = resolveDeepBucketLabel(track, dimension);
    const entry = groups.get(label) ?? {
      tracks: [],
      totalDuration: 0,
      playCount: 0,
      matchedCount: 0,
    };
    entry.tracks.push(track);
    entry.totalDuration += track.duration || 0;
    entry.playCount += playCountLookup ? playCountLookup(track) : track.playCount ?? 0;
    if (track.youtubeVideoId) entry.matchedCount += 1;
    groups.set(label, entry);
  }

  const bucketTotal = bucketTracks.length;
  const libTotal = Math.max(1, totalLibraryTracks);

  const sorted: DeepBreakdownSlice[] = Array.from(groups.entries())
    .map(([label, data]) => ({
      key: label,
      label,
      count: data.tracks.length,
      sharePct: Math.round((data.tracks.length / bucketTotal) * 100),
      librarySharePct: Math.round((data.tracks.length / libTotal) * 100),
      totalDuration: data.totalDuration,
      playCount: data.playCount,
      matchedCount: data.matchedCount,
      trackIds: data.tracks.map((t) => t.id),
      sampleTitles: data.tracks.slice(0, 3).map((t) => t.title),
    }))
    .sort((a, b) => {
      const aUnknown =
        a.label === 'Unknown Artist' ||
        a.label === 'No Year Tag' ||
        a.label === 'Unknown Length';
      const bUnknown =
        b.label === 'Unknown Artist' ||
        b.label === 'No Year Tag' ||
        b.label === 'Unknown Length';
      if (aUnknown && !bUnknown) return 1;
      if (bUnknown && !aUnknown) return -1;
      return b.count - a.count || b.totalDuration - a.totalDuration;
    });

  if (sorted.length <= maxSlices) {
    return sorted;
  }

  const primary = sorted.slice(0, maxSlices - 1);
  const tail = sorted.slice(maxSlices - 1);
  const tailTracks = tail.flatMap((s) => s.trackIds);
  const tailCount = tail.reduce((acc, s) => acc + s.count, 0);
  const tailDuration = tail.reduce((acc, s) => acc + s.totalDuration, 0);
  const tailPlays = tail.reduce((acc, s) => acc + s.playCount, 0);
  const tailMatched = tail.reduce((acc, s) => acc + s.matchedCount, 0);

  primary.push({
    key: '__remaining__',
    label: `Remaining ${tail.length} ${
      dimension === 'artist'
        ? 'artists'
        : dimension === 'folder'
          ? 'folders'
          : 'groups'
    }`,
    count: tailCount,
    sharePct: Math.round((tailCount / bucketTotal) * 100),
    librarySharePct: Math.round((tailCount / libTotal) * 100),
    totalDuration: tailDuration,
    playCount: tailPlays,
    matchedCount: tailMatched,
    trackIds: tailTracks,
    sampleTitles: tail.slice(0, 3).map((s) => s.label),
    isResidual: true,
  });

  return primary;
}


