/** Community-report strings. Kiswahili text is a DRAFT: it must be reviewed by a native speaker and (for safety wording) a public-health professional. */
export type Lang = 'en' | 'sw';
export const T = {
  en: {
    title: 'Report a water problem', s1: '1. What is the problem?', s2: '2. Add a photo (optional)', s3: '3. Where?', photo: 'Take or choose a photo', gps: 'Use my location', send: 'Send report',
    describe: 'Anything else we should know? (optional)', pick: 'Choose the nearest water point', offline: 'You are offline. Reports will be sent when you are back online.', online: 'Online',
    queued: 'Saved on this phone. It will be sent when you have signal.', thanks: 'Thank you. Your report was sent.', safe: 'Safety first', missing: 'Choose the type of problem.', loc: 'Choose a water point or use your location.',
    another: 'Report another problem', sendNow: 'Send now', waiting: 'Waiting to send', mine: 'My reports', locOk: 'Location captured', locFail: 'Could not get your location. Choose a water point from the list.',
    disclaimer: 'Reports are community observations. They are not laboratory results and the utility cannot guarantee a response time outside its own service targets.', privacy: 'Your name and phone number are visible only to the utility dispatchers. Photos have their location data removed.',
    safetyTitle: 'Safety first', safety: ['Do not drink, cook with or give this water to children or animals until the utility says it is safe.', 'Use another safe source, such as bottled or treated water, if you can.', 'Boiling may not remove chemical or fuel contamination.', 'If anyone feels sick, go to the nearest clinic and tell them about the water.'],
    safetyNote: 'This report is marked URGENT and is sent to the utility now. It is a community report, not a lab test.', retry: 'Try again', failed: 'Not sent', remove: 'Remove', signin: 'Sign in again to send saved reports.'
  },
  sw: {
    title: 'Ripoti tatizo la maji', s1: '1. Tatizo ni nini?', s2: '2. Ongeza picha (si lazima)', s3: '3. Mahali?', photo: 'Piga au chagua picha', gps: 'Tumia eneo langu', send: 'Tuma ripoti',
    describe: 'Kuna jambo lingine tunalopaswa kujua? (si lazima)', pick: 'Chagua kituo cha maji cha karibu', offline: 'Huna mtandao. Ripoti zitatumwa ukipata mtandao.', online: 'Una mtandao',
    queued: 'Imehifadhiwa kwenye simu. Itatumwa ukipata mtandao.', thanks: 'Asante. Ripoti imetumwa.', safe: 'Usalama kwanza', missing: 'Chagua aina ya tatizo.', loc: 'Chagua kituo cha maji au tumia GPS.',
    another: 'Ripoti tatizo lingine', sendNow: 'Tuma sasa', waiting: 'Inasubiri kutumwa', mine: 'Ripoti zangu', locOk: 'Eneo limepatikana', locFail: 'Eneo halikupatikana. Chagua kituo cha maji kwenye orodha.',
    disclaimer: 'Ripoti ni maoni ya jamii. Si matokeo ya maabara, na kampuni haiwezi kuahidi muda wa kujibu zaidi ya malengo yake yenyewe.', privacy: 'Jina na namba yako ya simu huonekana kwa wasimamizi wa kampuni pekee. Picha huondolewa taarifa za mahali.',
    safetyTitle: 'Usalama kwanza', safety: ['Usinywe, usipikie wala usiwape watoto au mifugo maji haya hadi kampuni ya maji itakapothibitisha ni salama.', 'Tumia chanzo kingine salama, kama maji ya chupa au yaliyotibiwa, ukiweza.', 'Kuchemsha huenda kusiondoe uchafu wa kemikali au mafuta.', 'Mtu akiumwa, nenda kliniki iliyo karibu na uwaambie kuhusu maji.'],
    safetyNote: 'Ripoti hii imewekwa DHARURA na inatumwa sasa. Si matokeo ya maabara. (Tafsiri inahitaji kukaguliwa na mzungumzaji wa Kiswahili na mtaalamu wa afya ya jamii.)', retry: 'Jaribu tena', failed: 'Haikutumwa', remove: 'Ondoa', signin: 'Ingia tena ili kutuma ripoti zilizohifadhiwa.'
  }
} as const;
export const pickLang = (q: string | undefined, cookie: string | undefined): Lang => (q === 'sw' || q === 'en' ? q : cookie === 'sw' ? 'sw' : 'en');
