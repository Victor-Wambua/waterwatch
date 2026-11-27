// SYNTHETIC DEMONSTRATION DATA — fictional utility "Mto Kijani Water Company" in fictional "Kijani County". Not real assets, people or readings.
window.WW={};
WW.org={name:'Mto Kijani Water Company',county:'Kijani County',label:'Synthetic demonstration data'};
WW.types={borehole:'Borehole',kiosk:'Water kiosk',waterpoint:'Community water point',pump:'Pump station',tank:'Storage tank',treatment:'Treatment works',valve:'Valve / distribution node'};
WW.statusLabel={operational:'Operational',degraded:'Degraded',down:'Out of service',contam:'Contamination alert',unknown:'Status unknown'};
const A=(id,name,type,x,y,status,owner,sensor,inst,last)=>({id,name,type,x,y,status,owner,sensor,inst,last});
WW.assets=[
A('A-001','Mto Kijani Treatment Works','treatment',50,20,'operational','Utility',true,2009,'2026-09-14'),
A('A-002','Ridge Tank 1 (500 m³)','tank',44,34,'operational','Utility',true,2012,'2026-08-02'),
A('A-003','Ridge Pump Station','pump',48,28,'degraded','Utility',true,2012,'2026-10-21'),
A('A-004','Soko Kiosk','kiosk',30,46,'operational','Vendor lease',false,2018,'2026-07-11'),
A('A-005','Maji Mapya Borehole','borehole',72,40,'down','Community committee',true,2016,'2026-11-03'),
A('A-006','Kwa Mama Njeri Water Point','waterpoint',18,62,'contam','Community committee',false,2015,'2026-06-20'),
A('A-007','Njiwa Kiosk','kiosk',60,58,'operational','Vendor lease',false,2019,'2026-09-30'),
A('A-008','Mlima Tank 2 (200 m³)','tank',68,26,'operational','Utility',true,2014,'2026-05-15'),
A('A-009','Kisima Borehole','borehole',82,66,'degraded','County government',true,2011,'2026-10-02'),
A('A-010','Shule Water Point','waterpoint',36,72,'operational','Community committee',false,2020,'2026-08-19'),
A('A-011','Bridge Valve V-12','valve',54,44,'operational','Utility',false,2012,'2026-04-08'),
A('A-012','Market Kiosk 2','kiosk',44,60,'unknown','Vendor lease',false,2021,'2026-03-30'),
A('A-013','Kivuko Pump Station','pump',26,30,'operational','NGO (programme)',true,2022,'2026-10-12'),
A('A-014','Mwamba Water Point','waterpoint',86,48,'operational','Community committee',false,2017,'2026-09-04'),
A('A-015','Eastgate Valve V-31','valve',74,56,'degraded','Utility',false,2013,'2026-10-28')
];
WW.links=[['A-001','A-003'],['A-003','A-002'],['A-002','A-011'],['A-011','A-007'],['A-011','A-005'],['A-001','A-008'],['A-008','A-005'],['A-005','A-015'],['A-015','A-009'],['A-015','A-014'],['A-007','A-012'],['A-012','A-010'],['A-011','A-004'],['A-004','A-006'],['A-013','A-004'],['A-013','A-003']];
const S=(id,assetId,kind,unit,state,mins,series)=>({id,assetId,kind,unit,state,mins,series});
const wave=(b,a,n=24,s=1)=>Array.from({length:n},(_,i)=>+(b+a*Math.sin(i/3.2+s)+((i*7+s*3)%5-2)*a*.12).toFixed(1));
WW.sensors=[
S('SIM-FL-01','A-001','flow','m³/h','ok',3,wave(210,30)),
S('SIM-LV-02','A-002','level','% full','ok',4,wave(68,12,24,2)),
S('SIM-PR-03','A-003','pressure','bar','ok',2,wave(3.1,.6,24,3).map((v,i)=>i>17?+(v-1.3).toFixed(1):v)),
S('SIM-FL-04','A-005','flow','m³/h','missing',1470,[...wave(14,3,14,1),...Array(10).fill(null)]),
S('SIM-LV-05','A-008','level','% full','ok',5,wave(74,9,24,4)),
S('SIM-FL-06','A-009','flow','m³/h','flatline',6,[...wave(9,2,12,2),...Array(12).fill(4.2)]),
S('SIM-PR-07','A-013','pressure','bar','late',95,wave(2.6,.3,24,5)),
S('SIM-LV-08','A-002','level','% full','ok',4,wave(70,10,24,6).reverse())
];
WW.techs=[{id:'T-1',name:'Peter Otieno (synthetic)',zone:'Ridge / North'},{id:'T-2',name:'Amina Wekesa (synthetic)',zone:'East / Boreholes'},{id:'T-3',name:'Joseph Kiprono (synthetic)',zone:'South / Kiosks'},{id:'T-4',name:'Grace Mutua (synthetic)',zone:'Treatment / Pumps'}];
WW.cats={nowater:{en:'No water',sw:'Hakuna maji',ico:'drop-off'},lowpressure:{en:'Low pressure',sw:'Maji yanatoka polepole',ico:'gauge'},leak:{en:'Leak / burst pipe',sw:'Bomba linavuja',ico:'leak'},pump:{en:'Pump not working',sw:'Pampu haifanyi kazi',ico:'wrench'},contam:{en:'Water looks / smells unsafe',sw:'Maji yanaonekana au kunuka vibaya',ico:'alert'},damage:{en:'Damaged facility',sw:'Kituo kimeharibika',ico:'damage'},access:{en:'Access problem',sw:'Tatizo la kufikia maji',ico:'lock'}};
const now=Date.now(),m=x=>now-x*60000;
WW.reports=[
{id:'R-2041',asset:'A-006',cat:'contam',text:'Water is brown with a strong smell since this morning. Children drank some.',lang:'en',photo:true,at:m(22),status:'new',reporter:'Verified reporter R-118 (synthetic)',gps:'-1.2931, 36.8210 (±12 m)'},
{id:'R-2040',asset:'A-005',cat:'nowater',text:'Hakuna maji tangu jana jioni. Pampu haisikiki.',lang:'sw',photo:false,at:m(65),status:'new',reporter:'Verified reporter R-044 (synthetic)',gps:'-1.2804, 36.9011 (±8 m)'},
{id:'R-2039',asset:'A-005',cat:'pump',text:'Pump house is silent and the panel light is off.',lang:'en',photo:true,at:m(130),status:'new',reporter:'Verified reporter R-071 (synthetic)',gps:'-1.2806, 36.9013 (±15 m)'},
{id:'R-2038',asset:'A-009',cat:'lowpressure',text:'Only a trickle at the tap since Monday.',lang:'en',photo:false,at:m(300),status:'new',reporter:'Verified reporter R-090 (synthetic)',gps:'-1.3102, 36.9210 (±20 m)'},
{id:'R-2037',asset:'A-015',cat:'leak',text:'Water flowing onto road beside the valve chamber.',lang:'en',photo:true,at:m(520),status:'linked',wo:'WO-318',reporter:'Verified reporter R-130 (synthetic)',gps:'-1.2950, 36.9120 (±9 m)'},
{id:'R-2036',asset:'A-012',cat:'damage',text:'Tap handle broken, kiosk locked by vendor?',lang:'en',photo:true,at:m(1200),status:'new',reporter:'Verified reporter R-018 (synthetic)',gps:'-1.2999, 36.8710 (±10 m)'},
{id:'R-2035',asset:'A-003',cat:'lowpressure',text:'Pressure drops every evening around 6pm.',lang:'en',photo:false,at:m(1500),status:'linked',wo:'WO-317',reporter:'Verified reporter R-100 (synthetic)',gps:'-1.2701, 36.8530 (±11 m)'}
];
// wo.slaMin = minutes remaining until SLA breach at load time (negative = breached)
WW.wos=[
{id:'WO-320',asset:'A-006',title:'Contamination response: isolate & sample',pri:'P1',status:'new',tech:null,slaMin:90,cost:0,mats:[],src:'R-2041'},
{id:'WO-319',asset:'A-005',title:'Borehole pump not running: inspect starter & motor',pri:'P1',status:'assigned',tech:'T-2',slaMin:210,cost:0,mats:[],src:'R-2040,R-2039'},
{id:'WO-318',asset:'A-015',title:'Valve chamber leak: replace gland packing',pri:'P2',status:'in_progress',tech:'T-1',slaMin:-35,cost:0,mats:[{n:'Gland packing 10 mm',q:2,c:180000}],src:'R-2037'},
{id:'WO-317',asset:'A-003',title:'Evening pressure drop: check VFD & suction',pri:'P2',status:'in_progress',tech:'T-4',slaMin:600,cost:0,mats:[],src:'R-2035'},
{id:'WO-316',asset:'A-009',title:'Low yield: pull pump, check rising main',pri:'P2',status:'parts',tech:'T-2',slaMin:1500,cost:0,mats:[],src:'R-2038'},
{id:'WO-315',asset:'A-012',title:'Kiosk tap replacement',pri:'P3',status:'assigned',tech:'T-3',slaMin:2800,cost:0,mats:[],src:'R-2036'},
{id:'WO-312',asset:'A-001',title:'Chlorinator dosing pump service',pri:'P3',status:'done',tech:'T-4',slaMin:0,cost:4200000,mats:[{n:'Diaphragm kit',q:1,c:3200000},{n:'Labour',q:1,c:1000000}],src:'planned'},
{id:'WO-309',asset:'A-014',title:'Hand-pump seal replacement',pri:'P3',status:'done',tech:'T-3',slaMin:0,cost:650000,mats:[{n:'Seal kit',q:1,c:650000}],src:'R-2011'}
];
WW.history={
'A-005':[['2026-11-03','Pump starter contactor replaced','Amina W.',1850000],['2026-08-17','Borehole flushed, yield test','Amina W.',420000],['2026-05-02','Pump motor rewound','Contractor (synthetic)',9600000],['2026-02-11','Starter contactor replaced','Amina W.',1790000]],
'A-009':[['2026-10-02','Rising main joint repaired','Amina W.',760000],['2026-07-20','Pump pulled, bearing replaced','Contractor (synthetic)',5100000]],
'A-003':[['2026-10-21','VFD parameter reset','Grace M.',0],['2026-06-05','Suction strainer cleaned','Grace M.',150000]],
'A-006':[['2026-06-20','Hand-pump rod replaced','Joseph K.',380000]]
};
// analytics fixtures (synthetic)
WW.an={weeks:['W41','W42','W43','W44','W45','W46','W47'],outages:[6,9,7,11,8,12,10],mttr:[19.5,22.1,18.0,26.4,21.0,24.8,23.2],
repeat:[['A-005','Maji Mapya Borehole',4,'Starter contactor (3 of 4)'],['A-009','Kisima Borehole',3,'Rising main joints'],['A-015','Eastgate Valve V-31',3,'Gland packing leaks'],['A-003','Ridge Pump Station',2,'VFD faults']],
downtime:[['Maji Mapya Borehole',61],['Kisima Borehole',38],['Eastgate Valve V-31',17],['Ridge Pump Station',9],['Market Kiosk 2',6]],
cost:[['Parts',12.4],['Labour',6.1],['Contractor',14.7],['Transport',1.3]]};
