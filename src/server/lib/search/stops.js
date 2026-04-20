/**
 * Stop configuration for the Gaudí walking tour archive search.
 * Each entry contains multilingual keywords, Wikimedia categories to crawl,
 * date ranges, and priority targets.
 */

export const STOPS = [
	{
		stopId: 'stop_1',
		stopName: 'Hospital de la Santa Creu',
		priority: 'high',
		targetCount: '5-8',
		keywords: {
			en: [
				'Hospital de la Santa Creu Barcelona',
				'Antoni Gaudí funeral 1926',
				'Gaudí funeral procession',
				'Gaudí death 1926',
				'Gaudí tram accident',
				'Gaudí deathbed',
				'Hospital de la Santa Creu courtyard',
				'National Library of Catalonia historic',
				'Barcelona Raval 1900s',
				'Barcelona 1868 revolution'
			],
			ca: [
				'Hospital de la Santa Creu Barcelona antic',
				'Enterrament Gaudí 1926',
				'Processó fúnebre Gaudí',
				'Biblioteca de Catalunya antic',
				'Raval Barcelona antic'
			],
			es: [
				'Hospital de la Santa Cruz Barcelona antiguo',
				'Funeral Gaudí 1926',
				'Procesión fúnebre Gaudí Barcelona',
				'Barrio del Raval Barcelona antiguo'
			]
		},
		categories: [
			'Category:Hospital de la Santa Creu',
			'Category:Funeral of Antoni Gaudí',
			'Category:Biblioteca de Catalunya'
		],
		dateRange: { earliest: 1860, latest: 1930 },
		priorityTargets: [
			"Gaudí's funeral procession photos (June 12, 1926)",
			'The hospital courtyard/galleries in the early 1900s',
			"Gaudí's last known photograph",
			"Joan Matamala's deathbed sketches",
			'Young Gaudí portrait (1868-1870s)',
			'Barcelona September Revolution 1868 imagery'
		]
	},
	{
		stopId: 'walking_1',
		stopName: 'The Student Soldier (1874-1878)',
		priority: 'low-medium',
		targetCount: '1-3',
		keywords: {
			en: [
				'Antoni Gaudí young portrait',
				'Gaudí student portrait 1870s',
				'Barcelona School of Architecture 1870s',
				"Escola d'Arquitectura Barcelona",
				'Elies Rogent architect',
				'Third Carlist War Spain',
				'Barcelona 1870s photographs'
			],
			ca: [
				'Gaudí jove retrat',
				"Escola Provincial d'Arquitectura Barcelona",
				'Elies Rogent arquitecte',
				'Tercera Guerra Carlina'
			],
			es: [
				'Gaudí joven retrato',
				'Escuela de Arquitectura Barcelona 1870',
				'Tercera Guerra Carlista'
			]
		},
		categories: [
			'Category:Antoni Gaudí',
			'Category:Portraits of Antoni Gaudí',
			'Category:Third Carlist War'
		],
		dateRange: { earliest: 1868, latest: 1880 },
		priorityTargets: [
			'Earliest known Gaudí portrait/photograph',
			'Barcelona School of Architecture building',
			'Elies Rogent portrait'
		]
	},
	{
		stopId: 'stop_2',
		stopName: 'Plaça de Sant Felip Neri',
		priority: 'medium',
		targetCount: '3-5',
		keywords: {
			en: [
				'Plaça Sant Felip Neri Barcelona',
				'Sant Felip Neri bombing 1938',
				'Sant Felip Neri church Barcelona',
				'Barcelona Civil War bombing',
				'Barcelona coppersmiths guild',
				'Joan Llimona painter',
				'Joan Llimona Barcelona'
			],
			ca: [
				'Plaça de Sant Felip Neri Barcelona antic',
				'Bombardeig Sant Felip Neri 1938',
				'Gremi calderers Barcelona',
				'Joan Llimona pintor'
			],
			es: [
				'Plaza San Felipe Neri Barcelona',
				'Bombardeo San Felipe Neri 1938',
				'Guerra Civil Barcelona bombardeo'
			]
		},
		categories: [
			'Category:Plaça de Sant Felip Neri',
			'Category:Bombing of Barcelona',
			'Category:Joan Llimona'
		],
		dateRange: { earliest: 1880, latest: 1940 },
		priorityTargets: [
			'The square before/after the 1938 bombing',
			'Historic photos showing the guild buildings',
			'Joan Llimona artwork or portrait',
			'The pockmarked facade (historic photos, not modern tourist shots)'
		]
	},
	{
		stopId: 'stop_3',
		stopName: 'Carrer del Call, 11 — First Workshop',
		priority: 'low',
		targetCount: '1-3',
		keywords: {
			en: [
				'Carrer del Call Barcelona historic',
				'Jewish Quarter Barcelona medieval',
				'El Call Barcelona',
				'Gaudí first workshop',
				'Josefa Moreu Gaudí',
				'Mataró Workers Cooperative Gaudí',
				'Cooperativa Obrera Mataroní',
				'Llorenç Matamala sculptor'
			],
			ca: [
				'Carrer del Call Barcelona antic',
				'Call jueu Barcelona',
				'Cooperativa Obrera Mataronina Gaudí',
				'Llorenç Matamala escultor'
			],
			es: [
				'Barrio judío Barcelona antiguo',
				'Cooperativa Obrera Mataronesa Gaudí'
			]
		},
		categories: [
			'Category:El Call (Barcelona)',
			'Category:Jewish history of Barcelona'
		],
		dateRange: { earliest: 1870, latest: 1900 },
		priorityTargets: [
			'Historic photos of Carrer del Call / the Jewish Quarter',
			'Any photo of the Mataró Workers Cooperative building',
			'Portrait of Josefa Moreu (rare but worth searching)',
			'Portrait of Llorenç Matamala'
		]
	},
	{
		stopId: 'stop_4',
		stopName: 'Plaça Reial — First Successes',
		priority: 'medium',
		targetCount: '3-5',
		keywords: {
			en: [
				'Plaça Reial Barcelona historic',
				'Gaudí lampposts Plaça Reial',
				'Gaudí streetlamps Barcelona',
				'Plaça Reial lampposts',
				'Barcelona 1880s photographs',
				'Joan Martorell architect Barcelona',
				'Sagrada Família early construction',
				'Francisco de Paula del Villar architect'
			],
			ca: [
				'Plaça Reial Barcelona antic',
				'Fanals Gaudí Plaça Reial',
				'Joan Martorell arquitecte',
				'Sagrada Família primers anys'
			],
			es: [
				'Plaza Real Barcelona antiguo',
				'Farolas Gaudí Plaza Real',
				'Sagrada Familia primeras obras'
			]
		},
		categories: [
			'Category:Plaça Reial',
			'Category:Lampposts by Antoni Gaudí',
			'Category:Streetlights in Barcelona'
		],
		dateRange: { earliest: 1875, latest: 1900 },
		priorityTargets: [
			'The Gaudí lampposts (historic photos, not modern)',
			'Plaça Reial in the 1880s-1890s',
			'Design drawings for the lampposts',
			'Portrait of Joan Martorell',
			'Earliest Sagrada Família construction photos (1882-1885)',
			'Portrait of Josep Maria Bocabella'
		]
	},
	{
		stopId: 'walking_2',
		stopName: 'Heartbreak and Grief (1879-1884)',
		priority: 'low',
		targetCount: '1-2',
		keywords: {
			en: [
				'Gaudí family photograph',
				'Barcelona Raval 1880s',
				'Antoni Gaudí 1880s portrait'
			],
			ca: [
				'Família Gaudí fotografia',
				'Raval Barcelona anys 1880'
			],
			es: [
				'Familia Gaudí fotografía'
			]
		},
		categories: [
			'Category:Portraits of Antoni Gaudí',
			'Category:Antoni Gaudí'
		],
		dateRange: { earliest: 1875, latest: 1890 },
		priorityTargets: [
			'Any Gaudí family photo (extremely rare)',
			'Gaudí portrait from the "dandy" period (1880s)'
		]
	},
	{
		stopId: 'stop_5',
		stopName: 'Palau Güell',
		priority: 'high',
		targetCount: '5-8',
		keywords: {
			en: [
				'Palau Güell construction',
				'Palau Güell Barcelona historic',
				'Palau Güell interior',
				'Palau Güell rooftop chimneys',
				'Palau Güell facade',
				'Eusebi Güell portrait',
				'Eusebi Güell photograph',
				'Paris 1878 Universal Exhibition',
				'Paris 1878 Exposition Universelle Spanish Pavilion',
				'Esteban Comella glove case Gaudí',
				'Carrer Nou de la Rambla Barcelona historic'
			],
			ca: [
				'Palau Güell Barcelona antic',
				'Palau Güell construcció',
				'Eusebi Güell retrat',
				'Exposició Universal París 1878',
				'Carrer Nou de la Rambla antic'
			],
			es: [
				'Palacio Güell Barcelona antiguo',
				'Palacio Güell construcción',
				'Eusebi Güell retrato',
				'Exposición Universal París 1878'
			]
		},
		categories: [
			'Category:Palau Güell',
			'Category:Interior of Palau Güell',
			'Category:Eusebi Güell',
			'Category:Exposition Universelle (1878)'
		],
		dateRange: { earliest: 1878, latest: 1910 },
		priorityTargets: [
			'Palau Güell under construction or shortly after completion (1886-1895)',
			'Rooftop chimneys (historic photos)',
			'Interior photos (central salon, starry dome ceiling)',
			'Portrait of Eusebi Güell',
			'The glove display case from the 1878 Paris Exhibition (very rare)',
			'Carrer Nou de la Rambla in the 1890s'
		]
	},
	{
		stopId: 'walking_3',
		stopName: 'Park Güell (1900-1914)',
		priority: 'medium',
		targetCount: '3-5',
		keywords: {
			en: [
				'Park Güell construction',
				'Park Güell early photographs',
				'Park Güell historic',
				'Park Güell Jujol bench',
				'Park Güell serpentine bench',
				'Park Güell Doric columns',
				'Muntanya Pelada Barcelona',
				'Park Güell dragon fountain',
				'Gaudí house Park Güell'
			],
			ca: [
				'Park Güell construcció',
				'Park Güell antic',
				'Park Güell banc ondulat',
				'Muntanya Pelada Barcelona'
			],
			es: [
				'Parque Güell construcción',
				'Parque Güell antiguo',
				'Parque Güell banco serpentino'
			]
		},
		categories: [
			'Category:Park Güell',
			'Category:History of Park Güell',
			'Category:Serpentine bench at Park Güell'
		],
		dateRange: { earliest: 1900, latest: 1930 },
		priorityTargets: [
			'Park Güell under construction (1900-1914)',
			'The empty plots (showing the commercial failure)',
			"Gaudí's house in Park Güell",
			'The serpentine bench before the crowds',
			'Hypostyle hall (Doric columns) early photos'
		]
	},
	{
		stopId: 'stop_6',
		stopName: 'Casa Calvet',
		priority: 'medium',
		targetCount: '3-5',
		keywords: {
			en: [
				'Casa Calvet Barcelona',
				'Casa Calvet Gaudí',
				'Casa Calvet facade',
				'Casa Calvet furniture',
				'Bishop Torras i Bages',
				'Josep Torras i Bages portrait',
				'Francesc Berenguer architect',
				'Gaudí 1890s portrait',
				'Spanish American War 1898',
				'Disaster of 98 Spain'
			],
			ca: [
				'Casa Calvet Barcelona',
				'Bisbe Torras i Bages retrat',
				'Francesc Berenguer arquitecte',
				'Desastre del 98'
			],
			es: [
				'Casa Calvet Barcelona',
				'Obispo Torras y Bages',
				'Desastre del 98 España'
			]
		},
		categories: [
			'Category:Casa Calvet',
			'Category:Josep Torras i Bages',
			'Category:Spanish-American War'
		],
		dateRange: { earliest: 1890, latest: 1905 },
		priorityTargets: [
			'Casa Calvet facade (historic, not modern)',
			'Interior furniture designed by Gaudí (oak pieces, no nails/screws)',
			'Portrait of Bishop Torras i Bages',
			'Portrait of Francesc Berenguer',
			'Gaudí portrait from the 1890s (post-transformation, ascetic period)'
		]
	},
	{
		stopId: 'walking_4',
		stopName: 'Manzana de la Discòrdia',
		priority: 'medium',
		targetCount: '3-5',
		keywords: {
			en: [
				'Manzana de la Discordia Barcelona',
				'Block of Discord Barcelona',
				'Casa Lleó Morera',
				'Casa Amatller Barcelona',
				'Lluís Domènech i Montaner portrait',
				'Josep Puig i Cadafalch portrait',
				'Passeig de Gràcia Barcelona historic',
				'Passeig de Gràcia 1900s',
				'Eixample Barcelona historic',
				'Catalan Modernisme architecture'
			],
			ca: [
				'Mansana de la Discòrdia Barcelona',
				'Casa Lleó i Morera',
				'Casa Amatller',
				'Lluís Domènech i Montaner retrat',
				'Josep Puig i Cadafalch retrat',
				'Passeig de Gràcia Barcelona antic',
				'Modernisme català arquitectura'
			],
			es: [
				'Manzana de la Discordia Barcelona',
				'Paseo de Gracia Barcelona antiguo',
				'Modernismo catalán arquitectura'
			]
		},
		categories: [
			'Category:Illa de la Discòrdia',
			'Category:Casa Lleó Morera',
			'Category:Casa Amatller',
			'Category:Lluís Domènech i Montaner',
			'Category:Josep Puig i Cadafalch',
			'Category:Passeig de Gràcia'
		],
		dateRange: { earliest: 1895, latest: 1915 },
		priorityTargets: [
			'The "Block of Discord" showing all three buildings together (period photo)',
			'Portraits of Domènech i Montaner and Puig i Cadafalch',
			'Casa Amatller under construction or shortly after completion',
			'Casa Lleó Morera historic photos',
			'Passeig de Gràcia streetscape in the early 1900s'
		]
	},
	{
		stopId: 'stop_7',
		stopName: 'Casa Batlló',
		priority: 'high',
		targetCount: '5-8',
		keywords: {
			en: [
				'Casa Batlló construction',
				'Casa Batlló historic Barcelona',
				'Casa Batlló facade historic',
				'Casa Batlló interior',
				'Josep Maria Jujol architect',
				'Josep Maria Jujol portrait',
				'Joan Martorell architect portrait',
				'Francesc Gaudí father coppersmith',
				'Gaudí father portrait',
				'Casa Batlló renovation 1904'
			],
			ca: [
				'Casa Batlló Barcelona antic',
				'Casa Batlló construcció',
				'Josep Maria Jujol arquitecte',
				'Joan Martorell arquitecte retrat'
			],
			es: [
				'Casa Batlló Barcelona antiguo',
				'Casa Batlló construcción',
				'Josep Maria Jujol arquitecto'
			]
		},
		categories: [
			'Category:Casa Batlló',
			'Category:History of Casa Batlló',
			'Category:Josep Maria Jujol'
		],
		dateRange: { earliest: 1900, latest: 1915 },
		priorityTargets: [
			'Casa Batlló during renovation (1904-1906)',
			"The building BEFORE Gaudí's renovation (the original facade)",
			'Historic photos of the completed facade',
			'Portrait of Josep Maria Jujol',
			'Interior historic photos',
			'The building alongside Casa Amatller for contrast'
		]
	},
	{
		stopId: 'stop_8',
		stopName: 'Casa Milà / La Pedrera',
		priority: 'high',
		targetCount: '5-8',
		keywords: {
			en: [
				'Casa Milà construction',
				'La Pedrera construction',
				'La Pedrera Barcelona historic',
				'La Pedrera rooftop chimneys historic',
				'Casa Milà facade construction',
				'Pere Milà Roser Segimon',
				'Gaudí Paris 1910 exhibition',
				'Gaudí Grand Palais Paris 1910',
				'Francesc Berenguer architect',
				'La Pedrera wrought iron balconies'
			],
			ca: [
				'Casa Milà Barcelona antic',
				'La Pedrera construcció',
				'La Pedrera xemeneies terrat',
				'Gaudí exposició París 1910',
				'Francesc Berenguer arquitecte'
			],
			es: [
				'Casa Milà Barcelona antiguo',
				'La Pedrera construcción',
				'Gaudí exposición París 1910'
			]
		},
		categories: [
			'Category:Casa Milà',
			'Category:Construction of Casa Milà',
			'Category:Roof of Casa Milà'
		],
		dateRange: { earliest: 1905, latest: 1915 },
		priorityTargets: [
			'La Pedrera under construction (scaffolding photos, 1906-1910)',
			'The rooftop chimneys/warriors (period photos)',
			"Wrought-iron balcony detail (Jujol's work)",
			"Photos from Gaudí's 1910 Paris exhibition at the Grand Palais",
			'Pere Milà and Roser Segimon portraits',
			'Period cartoon/satire of La Pedrera (contemporary mockery)'
		]
	},
	{
		stopId: 'walking_5',
		stopName: "The Rival's Towers / Cascade of Loss (1905-1918)",
		priority: 'medium',
		targetCount: '3-5',
		keywords: {
			en: [
				'Casa de les Punxes Barcelona',
				'Casa Terrades Barcelona',
				'Puig i Cadafalch Casa de les Punxes',
				'Mancomunitat de Catalunya',
				'Gaudí niece Rosa Egea',
				'Francesc Berenguer architect death',
				'Bishop Torras i Bages death',
				'Eusebi Güell death 1918'
			],
			ca: [
				'Casa de les Punxes Barcelona antic',
				'Casa Terrades',
				'Mancomunitat de Catalunya',
				'Puig i Cadafalch president Mancomunitat'
			],
			es: [
				'Casa de las Punxes Barcelona',
				'Mancomunidad de Cataluña'
			]
		},
		categories: [
			'Category:Casa de les Punxes',
			'Category:Mancomunitat de Catalunya',
			'Category:Josep Puig i Cadafalch'
		],
		dateRange: { earliest: 1903, latest: 1920 },
		priorityTargets: [
			'Casa de les Punxes (period photo, not modern)',
			'Puig i Cadafalch as politician/president of Mancomunitat',
			'Any photo showing the Eixample district in this period'
		]
	},
	{
		stopId: 'stop_9',
		stopName: 'Church of Sant Francesc de Sales',
		priority: 'medium',
		targetCount: '3-5',
		keywords: {
			en: [
				'Convent de les Saleses Barcelona',
				'Church Sant Francesc de Sales Barcelona',
				'Joan Martorell architect church',
				'Setmana Tràgica 1909 Barcelona',
				'Tragic Week Barcelona 1909',
				'Setmana Tràgica churches burning',
				'Barcelona churches burning 1909',
				'Francesc Ferrer i Guàrdia',
				'Ferrer i Guàrdia execution',
				'Gaudí arrest 1924',
				'Jocs Florals Barcelona',
				'Josep Brangulí photographer',
				'Brangulí nuns Civil War Barcelona',
				'Spanish Civil War Barcelona churches 1936'
			],
			ca: [
				'Convent de les Saleses Barcelona',
				'Setmana Tràgica 1909 Barcelona',
				'Setmana Tràgica crema esglésies',
				'Francesc Ferrer i Guàrdia',
				'Jocs Florals Barcelona',
				'Josep Brangulí fotògraf',
				'Guerra Civil Barcelona esglésies 1936'
			],
			es: [
				'Semana Trágica Barcelona 1909',
				'Semana Trágica quema iglesias',
				'Francisco Ferrer Guardia',
				'Guerra Civil Barcelona iglesias 1936'
			]
		},
		categories: [
			'Category:Setmana Tràgica',
			'Category:Tragic Week (Spain)',
			'Category:Francesc Ferrer i Guàrdia',
			'Category:Spanish Civil War in Barcelona',
			'Category:Anticlerical violence during the Spanish Civil War'
		],
		dateRange: { earliest: 1882, latest: 1940 },
		priorityTargets: [
			"The church building (historic photos showing Martorell's design)",
			'Setmana Tràgica street scenes (July 1909)',
			'Burning churches during the Setmana Tràgica',
			'Portrait or photo of Francesc Ferrer i Guàrdia',
			"Brangulí's Civil War photographs (exhumed nuns, church destruction)",
			'Passeig de Sant Joan in the early 1900s',
			"Any documentation of Gaudí's 1924 arrest"
		]
	},
	{
		stopId: 'stop_10',
		stopName: 'Sagrada Família',
		priority: 'high',
		targetCount: '5-8',
		keywords: {
			en: [
				'Sagrada Família construction 1900s',
				'Sagrada Família construction 1920s',
				'Sagrada Família early construction',
				'Sagrada Família Nativity Facade construction',
				'Sagrada Família 1890s',
				'Sagrada Família crypt',
				'Gaudí workshop Sagrada Família',
				'Gaudí workshop models',
				'Gaudí plaster models',
				'Gaudí last photograph',
				'Gaudí burial crypt',
				'Josep Maria Bocabella portrait',
				'Francisco de Paula del Villar architect',
				'Tower of Saint Barnabas Sagrada Família',
				'Sagrada Família funeral procession 1926'
			],
			ca: [
				'Sagrada Família construcció',
				'Sagrada Família primers anys',
				'Sagrada Família cripta',
				'Taller Gaudí Sagrada Família',
				'Gaudí maquetes',
				'Gaudí última fotografia',
				'Josep Maria Bocabella retrat'
			],
			es: [
				'Sagrada Familia construcción',
				'Sagrada Familia primeros años',
				'Taller Gaudí Sagrada Familia',
				'Gaudí última fotografía',
				'Sagrada Familia cripta'
			]
		},
		categories: [
			'Category:Sagrada Família',
			'Category:Construction of Sagrada Família',
			'Category:Nativity façade of the Sagrada Família',
			'Category:Crypt of the Sagrada Família',
			'Category:History of the Sagrada Família',
			'Category:Antoni Gaudí'
		],
		dateRange: { earliest: 1882, latest: 1930 },
		priorityTargets: [
			'Sagrada Família construction progression (1882, 1890s, 1900s, 1910s, 1920s)',
			'The Nativity Facade in progress',
			'Tower of Saint Barnabas completion (1925)',
			"Gaudí's workshop with plaster models (before 1936 destruction)",
			"Gaudí's last known photo",
			"Gaudí's funeral arriving at Sagrada Família (June 12, 1926)",
			'The crypt / burial site',
			'Portrait of Josep Maria Bocabella',
			'Portrait/photo of Francisco de Paula del Villar',
			'The destroyed models and drawings (pre-1936 photos showing what was lost)'
		]
	},
	{
		stopId: 'general',
		stopName: 'General / Cross-Stop',
		priority: 'low',
		targetCount: '3-5',
		keywords: {
			en: [
				'Antoni Gaudí portrait',
				'Antoni Gaudí photograph',
				'Gaudí drawings architectural',
				'Barcelona 1900 panoramic',
				'Barcelona Eixample 1900s',
				'Barcelona Gothic Quarter 1900s',
				'Catalan Modernisme',
				'Barcelona modernisme architecture',
				'Barcelona map 1900'
			],
			ca: [
				'Antoni Gaudí retrat',
				'Barcelona panoràmica 1900',
				'Modernisme català',
				'Eixample Barcelona antic',
				'Barri Gòtic Barcelona antic'
			],
			es: [
				'Antoni Gaudí retrato',
				'Barcelona panorámica 1900',
				'Modernismo catalán'
			]
		},
		categories: [
			'Category:Antoni Gaudí',
			'Category:Portraits of Antoni Gaudí',
			'Category:Works of Antoni Gaudí',
			'Category:Modernisme',
			'Category:Architecture of Barcelona',
			'Category:History of Barcelona',
			'Category:Maps of Barcelona',
			'Category:Old photographs of Barcelona'
		],
		dateRange: { earliest: 1850, latest: 1940 },
		priorityTargets: [
			'Gaudí portraits across different periods',
			'Barcelona panoramic views from the era',
			'Maps showing the city during his lifetime'
		]
	}
];

export function getStopById(stopId) {
	return STOPS.find(s => s.stopId === stopId) || null;
}
