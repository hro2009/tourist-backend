import 'dotenv/config';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { db } from './db.js';

const tours = [
  { slug: 'garni-geghard-monastery', category: 'Culture', duration: '5 hours', price: 9750, difficulty: 'easy', name: 'Garni Temple and Geghard Monastery', description: 'Hellenistic temple, a monastery carved into the rock, and a lavash baking stop.', highlights: ['Garni Temple', 'Geghard Monastery', 'Lavash baking stop'] },
  { slug: 'khor-virap-areni-noravank', category: 'Food & Wine', duration: '9 hours', price: 17550, difficulty: 'easy', name: 'Khor Virap, Areni wine and Noravank', description: 'Ararat views, a local winery tasting and the red cliffs of Noravank.', highlights: ['Khor Virap monastery', 'Areni winery tasting', 'Noravank red cliffs'] },
  { slug: 'lake-sevan-dilijan', category: 'Culture', duration: '9 hours', price: 15600, difficulty: 'easy', name: 'Lake Sevan and Dilijan', description: 'Sevanavank on the lake shore, Dilijan’s old street and forest walks.', highlights: ['Sevanavank', 'Dilijan old street', 'Forest walks'] },
  { slug: 'yerevan-city-tour', category: 'Culture', duration: '4 hours', price: 7800, difficulty: 'easy', name: 'Yerevan city tour', description: 'Republic Square, the Cascade, the Matenadaran and a brandy tasting.', highlights: ['Republic Square', 'The Cascade', 'Matenadaran and brandy tasting'] },
  { slug: 'echmiadzin-zvartnots-ruins', category: 'Culture', duration: '4 hours', price: 7800, difficulty: 'easy', name: 'Echmiadzin and Zvartnots ruins', description: 'The Mother Cathedral, St. Hripsime church and the ancient Zvartnots ruins.', highlights: ['Mother Cathedral', 'St. Hripsime church', 'Zvartnots ruins'] },
  { slug: 'tatev-monastery-cable-car', category: 'Culture', duration: '12 hours', price: 21450, difficulty: 'easy', name: 'Tatev Monastery and cable car', description: 'A cable car over the gorge, Tatev monastery and the Devil’s Bridge.', highlights: ['Wings of Tatev cable car', 'Tatev Monastery', 'Devil’s Bridge'] }
];

const tourTranslations = {
  'garni-geghard-monastery': ['Храм Гарни и монастырь Гегард', 'Эллинистический храм, высеченный в скале монастырь и остановка с выпечкой лаваша.', ['Храм Гарни', 'Монастырь Гегард', 'Выпечка лаваша'], 'Գառնիի տաճար և Գեղարդի վանք', 'Հելլենիստական տաճար, ժայռափոր վանք և լավաշի թխման կանգառ։', ['Գառնիի տաճար', 'Գեղարդի վանք', 'Լավաշի թխում']],
  'khor-virap-areni-noravank': ['Хор Вирап, вино Арени и Нораванк', 'Виды на Арарат, дегустация в местной винодельне и красные скалы Нораванка.', ['Монастырь Хор Вирап', 'Дегустация вина Арени', 'Красные скалы Нораванка'], 'Խոր Վիրապ, Արենիի գինի և Նորավանք', 'Արարատի տեսարաններ, համտես տեղական գինեգործարանում և Նորավանքի կարմիր ժայռերը։', ['Խոր Վիրապի վանք', 'Արենիի գինու համտես', 'Նորավանքի կարմիր ժայռեր']],
  'lake-sevan-dilijan': ['Озеро Севан и Дилижан', 'Севанаванк на берегу озера, старая улица Дилижана и прогулки по лесу.', ['Севанаванк', 'Старая улица Дилижана', 'Лесные прогулки'], 'Սևանա լիճ և Դիլիջան', 'Սևանավանք՝ լճի ափին, Դիլիջանի հին փողոցը և անտառային զբոսանքներ։', ['Սևանավանք', 'Դիլիջանի հին փողոց', 'Անտառային զբոսանքներ']],
  'yerevan-city-tour': ['Экскурсия по Еревану', 'Площадь Республики, Каскад, Матенадаран и дегустация коньяка.', ['Площадь Республики', 'Каскад', 'Матенадаран и дегустация коньяка'], 'Երևանի քաղաքային շրջագայություն', 'Հանրապետության հրապարակը, Կասկադը, Մատենադարանը և կոնյակի համտեսը։', ['Հանրապետության հրապարակ', 'Կասկադ', 'Մատենադարան և կոնյակի համտես']],
  'echmiadzin-zvartnots-ruins': ['Эчмиадзин и руины Звартноца', 'Кафедральный собор, церковь Святой Рипсиме и древние руины Звартноца.', ['Кафедральный собор', 'Церковь Святой Рипсиме', 'Руины Звартноца'], 'Эջմիածին և Զվարթնոցի ավերակներ', 'Մայր տաճարը, Սուրբ Հռիփսիմե եկեղեցին և Զվարթնոցի հնագույն ավերակները։', ['Մայր տաճար', 'Սուրբ Հռիփսիմե եկեղեցի', 'Զվարթնոցի ավերակներ']],
  'tatev-monastery-cable-car': ['Монастырь Татев и канатная дорога', 'Канатная дорога над ущельем, монастырь Татев и Чёртов мост.', ['Канатная дорога «Крылья Татева»', 'Монастырь Татев', 'Чёртов мост'], 'Տաթևի վանք և ճոպանուղի', 'Ճոպանուղի կիրճի վրայով, Տաթևի վանք և Սատանի կամուրջ։', ['«Տաթևի թևեր» ճոպանուղի', 'Տաթևի վանք', 'Սատանի կամուրջ']]
};

const addons = [
  ['lun', 'Lunch at a local restaurant', 'Обед в местном ресторане', 'Ճաշ տեղական ռեստորանում', 4680, 'per_person'],
  ['private-guide-car', 'Private guide and car for your group', 'Индивидуальный гид и автомобиль для группы', 'Անհատական ուղեկցորդ և մեքենա ձեր խմբի համար', 15600, 'per_booking']
];

const services = [
  ['Private driver', 'English, Russian or Armenian-speaking driver with a comfortable car, by the day.', 'Частный водитель', 'Водитель с комфортным автомобилем на весь день.', 'Անհատական վարորդ', 'Հարմարավետ մեքենայով վարորդ՝ ամբողջ օրվա համար։', 'car'],
  ['Airport transfer', 'Fixed-price pickup from Zvartnots with a name sign and flight tracking.', 'Трансфер из аэропорта', 'Встреча в Звартноце с табличкой и отслеживанием рейса.', 'Տրանսֆեր օդանավակայանից', 'Զվարթնոցում դիմավորում՝ անվանական ցուցանակով և թռիչքի հետևմամբ։', 'plane'],
  ['Stays', 'Guesthouses in Dilijan, Goris and Yerevan, hand-picked and checked by our team.', 'Проживание', 'Проверенные гостевые дома в Дилижане, Горисе и Ереване.', 'Կեցություն', 'Մեր թիմի կողմից ընտրված հյուրատներ Դիլիջանում, Գորիսում և Երևանում։', 'bed'],
  ['Workshops', 'Bake lavash, make khorovats, or learn to blend a wine in Vayots Dzor.', 'Мастер-классы', 'Испеките лаваш, приготовьте хоровац или смешайте вино в Вайоц Дзоре.', 'Վարպետաց դասեր', 'Թխեք լավաշ, պատրաստեք խորոված կամ սովորեք գինի խառնել Վայոց Ձորում։', 'bread'],
  ['Photographer', 'A local photographer joins your tour for a gallery delivered in three days.', 'Фотограф', 'Местный фотограф присоединится к туру; галерея будет готова за три дня.', 'Լուսանկարիչ', 'Տեղացի լուսանկարիչը կմիանա ձեր շրջագայությանը։ Լուսանկարները՝ երեք օրում։', 'camera'],
  ['Group and corporate', 'Retreats, weddings and conferences for 10 to 200 people.', 'Групповые и корпоративные поездки', 'Ретриты, свадьбы и конференции для групп от 10 до 200 человек.', 'Խմբային և կորպորատիվ', 'Հանգստի ուղևորություններ, հարսանիքներ և համաժողովներ՝ 10-ից 200 հոգու համար։', 'people']
];

const settings = {
  brand_name: 'Hayq', logo_url: '', tours_background_url: '', contact_phone: '', whatsapp: '', telegram: '', contact_email: '', usd_rate: '390',
  hero_title: "Land. We'll handle the rest.", hero_title_ru: 'Прилетайте. Об остальном позаботимся мы.', hero_title_hy: 'Ժամանեք։ Մնացածի մասին կհոգանք մենք։',
  hero_text: 'Private airport transfers and local tours, from the arrivals gate to the mountain trail.',
  hero_text_ru: 'Индивидуальные трансферы и местные туры — от выхода из аэропорта до горных троп.',
  hero_text_hy: 'Անհատական տրանսֆերներ և տեղական շրջագայություններ՝ օդանավակայանից մինչև լեռնային արահետներ։',
  hero_cta: 'Browse tours', hero_cta_ru: 'Смотреть туры', hero_cta_hy: 'Դիտել շրջագայությունները',
  about_text: 'Local guides, thoughtful routes and small groups across Armenia.',
  about_text_ru: 'Местные гиды, продуманные маршруты и небольшие группы по всей Армении.',
  about_text_hy: 'Տեղացի ուղեկցորդներ, մտածված երթուղիներ և փոքր խմբեր ամբողջ Հայաստանում։',
  currency_default: 'AMD',
  transfer_routes: JSON.stringify([
    { id: 'zvartnots-yerevan', airport: 'Zvartnots Airport, Yerevan', airport_ru: 'Аэропорт Звартноц, Ереван', airport_hy: 'Զվարթնոց օդանավակայան, Երևան', from: 'Zvartnots Airport', from_ru: 'Аэропорт Звартноц', from_hy: 'Զվարթնոց օդանավակայան', to: 'Yerevan', to_ru: 'Ереван', to_hy: 'Երևան', distance: '12 km', duration: '20 minutes', sedan_amd: 0, minivan_amd: 0 },
    { id: 'yerevan-zvartnots', airport: 'Zvartnots Airport, Yerevan', airport_ru: 'Аэропорт Звартноц, Ереван', airport_hy: 'Զվարթնոց օդանավակայան, Երևան', from: 'Yerevan', from_ru: 'Ереван', from_hy: 'Երևան', to: 'Zvartnots Airport', to_ru: 'Аэропорт Звартноц', to_hy: 'Զվարթնոց օդանավակայան', distance: '12 km', duration: '20 minutes', sedan_amd: 0, minivan_amd: 0 },
    { id: 'gyumri-yerevan', airport: 'Gyumri Airport', airport_ru: 'Аэропорт Гюмри', airport_hy: 'Գյումրի օդանավակայան', from: 'Gyumri Airport', from_ru: 'Аэропорт Гюмри', from_hy: 'Գյումրի օդանավակայան', to: 'Yerevan', to_ru: 'Ереван', to_hy: 'Երևան', distance: '125 km', duration: '2 hours', sedan_amd: 0, minivan_amd: 0 },
    { id: 'yerevan-gyumri', airport: 'Gyumri Airport', airport_ru: 'Аэропорт Гюмри', airport_hy: 'Գյումրի օդանավակայան', from: 'Yerevan', from_ru: 'Ереван', from_hy: 'Երևան', to: 'Gyumri Airport', to_ru: 'Аэропорт Гюмри', to_hy: 'Գյումրի օդанավակայան', distance: '125 km', duration: '2 hours', sedan_amd: 0, minivan_amd: 0 }
  ]),
  transfer_extras: JSON.stringify([{ id: 'child-seat', name_en: 'Child seat', name_ru: 'Детское кресло', name_hy: 'Մանկական նստատեղ', price_amd: 0 }, { id: 'extra-stop', name_en: 'Extra stop on the way', name_ru: 'Дополнительная остановка', name_hy: 'Լրացուցիչ կանգառ', price_amd: 0 }]),
  landing_copy_en: JSON.stringify({
    heroTitle: "Land. We'll handle the rest.", heroEyebrow: 'Your local welcome to Armenia', flightNotificationTitle: 'Flight 417', flightNotificationText: 'Landed. Your driver is waiting at the arrivals gate.', heroLocationLabel: 'Armenia, with a local',
    servicesEyebrow: 'Your trip, made easy', servicesTitle: 'Two services, done properly', servicesDescription: 'Choose a service to see routes and prices.',
    transferTitle: 'Airport transfer', transferDescription: 'Zvartnots and Gyumri airports to Yerevan and back, by private car or minibus. Fixed prices and flight tracking.',
    toursTitle: 'Tours', toursDescription: 'Six day trips from Yerevan with licensed local guides, from ancient temples to mountain monasteries.',
    transferPanelTitle: 'Airport transfers', transferPanelDescription: 'Prices are per car, not per person.', tourPanelTitle: 'Tours from Yerevan', tourPanelDescription: 'Prices are per person for groups of 2 or more. Private tours on request.',
    whyEyebrow: 'Four promises we keep', whyTitle: 'Why travelers choose us', whyDescription: 'Four promises we keep on every trip. Hover to pause the cube.',
    promise1Title: 'Fixed prices', promise1Description: 'You see your total before you book. No surprises at the end.',
    promise2Title: 'Flight tracking', promise2Description: 'Early or late, we adjust your pickup to your flight.',
    promise3Title: 'Local people', promise3Description: 'Drivers and guides who live here and know every road.',
    promise4Title: 'Always reachable', promise4Description: 'Message our local team whenever you need us.',
    travelGuideEyebrow: 'Local planning for your Armenia trip',
    travelGuideTitle: 'Plan your Armenia trip with a local team',
    travelGuideIntro: 'Arrive in Yerevan, travel at your own pace, and explore Armenia with practical help from a team based here. Hayq brings airport pickup, private transport and guided day tours together in one place.',
    travelGuideAirportTitle: 'Airport transfers in Armenia',
    travelGuideAirportText: 'Book a private car between Zvartnots International Airport and Yerevan, or arrange a longer transfer from Gyumri Airport. Choose a sedan for up to three passengers or a minivan for up to seven. Share your arrival details and pickup address so your driver can plan the meeting.',
    travelGuideAirportLink: 'View transfer routes and prices',
    travelGuideToursTitle: 'Day tours from Yerevan',
    travelGuideToursText: 'Use Yerevan as a base for Armenia day trips with local guides. Visit Garni Temple and Geghard Monastery, see Mount Ararat from Khor Virap, continue to Areni and Noravank, or combine Lake Sevan with Dilijan. Longer routes include Tatev Monastery and its cable car. Tour durations and current prices are shown before you book.',
    travelGuideToursLink: 'Explore Armenia tours',
    travelGuidePlanningTitle: 'A practical way to plan',
    travelGuidePlanningText: 'Tell us your dates, group size and interests. We can help coordinate an airport pickup with your stay in Yerevan, suggest a route that fits your schedule, and explain which trips work best as day tours. Prices are displayed in AMD or converted to USD using the current site rate.',
    travelGuidePlanningLink: 'Request a custom Armenia itinerary',
    travelFaqTitle: 'Frequently asked questions about visiting Armenia',
    travelFaqTransferQuestion: 'Can I book an airport transfer from Zvartnots to Yerevan?',
    travelFaqTransferAnswer: 'Yes. Choose the Zvartnots Airport to Yerevan route, select a sedan or minivan, and add your arrival time and flight number in the booking form.',
    travelFaqToursQuestion: 'Can I take day tours to Armenia’s main sights from Yerevan?',
    travelFaqToursAnswer: 'Yes. The tour collection includes Garni and Geghard, Khor Virap and Noravank, Lake Sevan and Dilijan, and other routes. Check each tour for its duration, available departure dates and price.',
    travelFaqPrivateQuestion: 'Can you arrange a private or custom trip in Armenia?',
    travelFaqPrivateAnswer: 'Send your travel dates, group size and preferred destinations using the custom request form. The local team can follow up with a route and a clear quote.',
    customEyebrow: 'Made for your trip', customTitle: 'Need something custom?', customDescription: 'Tell us your plans and we’ll send a fixed price within one working day.'
  }),
  landing_copy_ru: JSON.stringify({
    heroTitle: 'Прилетайте. Об остальном позаботимся мы.', heroEyebrow: 'Ваше местное знакомство с Арменией', flightNotificationTitle: 'Рейс 417 приземлился', flightNotificationText: 'Водитель ждёт вас у выхода из зоны прилёта.', heroLocationLabel: 'Армения глазами местных',
    servicesEyebrow: 'Путешествуйте без забот', servicesTitle: 'Два сервиса — как надо', servicesDescription: 'Выберите услугу, чтобы узнать подробности и спланировать следующий шаг.',
    transferTitle: 'Трансфер из аэропорта', transferDescription: 'Спокойная встреча в Звартноце или Гюмри и поездка по вашему адресу в Ереване.',
    toursTitle: 'Туры', toursDescription: 'Продуманные местные маршруты к монастырям, по горным дорогам и к армянской кухне.',
    transferPanelTitle: 'Трансферы из аэропорта', transferPanelDescription: 'Индивидуальные поездки с фиксированной ценой за автомобиль. Запросите стоимость.', tourPanelTitle: 'Туры из Еревана', tourPanelDescription: 'Небольшие группы, местные гиды и актуальные цены из каталога.',
    whyEyebrow: 'Четыре обещания, которые мы выполняем', whyTitle: 'Почему путешественники выбирают нас', whyDescription: 'На что вы можете рассчитывать с момента прилёта.',
    promise1Title: 'Фиксированные цены', promise1Description: 'Вы увидите полную стоимость до бронирования. Никаких сюрпризов.',
    promise2Title: 'Отслеживание рейса', promise2Description: 'Мы подстроим встречу под ранний или задержанный рейс.',
    promise3Title: 'Местная команда', promise3Description: 'Водители и гиды живут здесь и знают каждую дорогу.',
    promise4Title: 'Всегда на связи', promise4Description: 'Наша команда рядом, когда вам нужна помощь.',
    travelGuideEyebrow: 'Планирование поездки по Армении с местными',
    travelGuideTitle: 'Спланируйте поездку в Армению с местной командой',
    travelGuideIntro: 'Прилетайте в Ереван, путешествуйте в своём темпе и открывайте Армению с помощью команды, которая живёт здесь. Hayq объединяет встречу в аэропорту, частные поездки и экскурсии из Еревана.',
    travelGuideAirportTitle: 'Трансферы из аэропортов Армении',
    travelGuideAirportText: 'Закажите индивидуальную поездку из международного аэропорта Звартноц в Ереван или более длинный трансфер из аэропорта Гюмри. Седан рассчитан максимум на трёх пассажиров, минивэн — на семерых. Укажите данные рейса и адрес подачи автомобиля.',
    travelGuideAirportLink: 'Маршруты и цены на трансферы',
    travelGuideToursTitle: 'Экскурсии из Еревана на целый день',
    travelGuideToursText: 'Ереван удобно использовать как отправную точку для поездок по Армении с местными гидами. Посетите храм Гарни и монастырь Гегард, полюбуйтесь Араратом из Хор Вирапа, отправьтесь в Арени и Нораванк или совместите озеро Севан с Дилижаном. В дальних маршрутах — монастырь Татев и канатная дорога. Продолжительность и актуальная цена указаны до бронирования.',
    travelGuideToursLink: 'Посмотреть экскурсии по Армении',
    travelGuidePlanningTitle: 'Планирование без лишних хлопот',
    travelGuidePlanningText: 'Расскажите о датах, составе группы и интересах. Мы поможем совместить встречу в аэропорту с размещением в Ереване, подобрать маршрут по расписанию и подсказать подходящие однодневные поездки. Цены указаны в AMD или пересчитываются в USD по текущему курсу сайта.',
    travelGuidePlanningLink: 'Запросить индивидуальный маршрут по Армении',
    travelFaqTitle: 'Частые вопросы о поездке в Армению',
    travelFaqTransferQuestion: 'Можно ли заказать трансфер из Звартноца в Ереван?',
    travelFaqTransferAnswer: 'Да. Выберите маршрут «Аэропорт Звартноц — Ереван», седан или минивэн, затем укажите время прибытия и номер рейса в форме бронирования.',
    travelFaqToursQuestion: 'Можно ли съездить из Еревана к главным достопримечательностям Армении?',
    travelFaqToursAnswer: 'Да. В каталоге есть маршруты в Гарни и Гегард, Хор Вирап и Нораванк, к озеру Севан и в Дилижан, а также другие направления. Продолжительность, доступные даты и цена указаны в карточке каждой экскурсии.',
    travelFaqPrivateQuestion: 'Можно ли организовать частную или индивидуальную поездку по Армении?',
    travelFaqPrivateAnswer: 'Укажите даты поездки, размер группы и интересующие места в форме индивидуального запроса. Местная команда предложит маршрут и понятную стоимость.',
    customEyebrow: 'Индивидуально для вас', customTitle: 'Нужен особый маршрут?', customDescription: 'Расскажите о своих планах. Местная команда предложит маршрут и понятную цену.'
  }),
  landing_copy_hy: JSON.stringify({
    heroTitle: 'Ժամանեք։ Մնացածի մասին կհոգանք մենք։', heroEyebrow: 'Ձեր տեղական դիմավորումը Հայաստանում', flightNotificationTitle: 'Չվերթ 417-ը վայրէջք է կատարել', flightNotificationText: 'Ձեր վարորդը սպասում է ժամանման սրահում։', heroLocationLabel: 'Հայաստանը՝ տեղացիների հետ',
    servicesEyebrow: 'Ձեր ուղևորությունը՝ ավելի հեշտ', servicesTitle: 'Երկու ծառայություն՝ ինչպես հարկն է', servicesDescription: 'Ընտրեք ծառայությունը՝ մանրամասները տեսնելու և հաջորդ քայլը պլանավորելու համար։',
    transferTitle: 'Տրանսֆեր օդանավակայանից', transferDescription: 'Հանգիստ դիմավորում Զվարթնոցում կամ Գյումրիում և անհատական ուղևորություն դեպի ձեր հասցեն Երևանում։',
    toursTitle: 'Շրջագայություններ', toursDescription: 'Մտածված տեղական ուղևորություններ Հայաստանի վանքերով, լեռնային ճանապարհներով և համերով։',
    transferPanelTitle: 'Տրանսֆերներ օդանավակայանից', transferPanelDescription: 'Անհատական ուղևորություններ՝ մեկ մեքենայի ֆիքսված գնով։ Հարցրեք արժեքը։', tourPanelTitle: 'Շրջագայություններ Երևանից', tourPanelDescription: 'Փոքր խմբեր, տեղացի ուղեկցորդներ և ընթացիկ գներ մեր ցանկից։',
    whyEyebrow: 'Չորս խոստում, որ կատարում ենք', whyTitle: 'Ինչու են ճանապարհորդներն ընտրում մեզ', whyDescription: 'Ինչի վրա կարող եք հույս դնել ժամանման պահից։',
    promise1Title: 'Ֆիքսված գներ', promise1Description: 'Մինչև ամրագրելը կտեսնեք ամբողջ գումարը։ Անակնկալներ չեն լինի։',
    promise2Title: 'Չվերթի հետևում', promise2Description: 'Դիմավորումը կհարմարեցնենք ձեր չվերթին՝ նույնիսկ ուշացման դեպքում։',
    promise3Title: 'Տեղացիներ', promise3Description: 'Վարորդներն ու ուղեկցորդները տեղացի են և գիտեն բոլոր ճանապարհները։',
    promise4Title: 'Միշտ կապի մեջ', promise4Description: 'Մեր տեղական թիմը հասանելի է, երբ օգնության կարիք ունեք։',
    travelGuideEyebrow: 'Հայաստանի ուղևորության տեղական պլանավորում',
    travelGuideTitle: 'Պլանավորեք ձեր ուղևորությունը Հայաստան տեղական թիմի հետ',
    travelGuideIntro: 'Ժամանեք Երևան, ճանապարհորդեք ձեր տեմպով և բացահայտեք Հայաստանը այստեղ բնակվող թիմի աջակցությամբ։ Hayq-ը մեկ վայրում միավորում է օդանավակայանի դիմավորումը, անհատական ուղևորությունները և Երևանից էքսկուրսիաները։',
    travelGuideAirportTitle: 'Տրանսֆերներ Հայաստանի օդանավակայաններից',
    travelGuideAirportText: 'Ամրագրեք անհատական մեքենա «Զվարթնոց» միջազգային օդանավակայանից Երևան կամ ավելի երկար տրանսֆեր Գյումրու օդանավակայանից։ Սեդանը նախատեսված է մինչև երեք, իսկ մինիվենը՝ մինչև յոթ ուղևորի համար։ Նշեք չվերթի տվյալներն ու մեքենայի մատուցման հասցեն։',
    travelGuideAirportLink: 'Տեսնել տրանսֆերների երթուղիներն ու գները',
    travelGuideToursTitle: 'Մեկօրյա էքսկուրսիաներ Երևանից',
    travelGuideToursText: 'Երևանը հարմար մեկնակետ է տեղական ուղեկցորդների հետ Հայաստանի տեսարժան վայրերն այցելելու համար։ Այցելեք Գառնիի տաճարն ու Գեղարդի վանքը, Խոր Վիրապից տեսեք Արարատը, շարունակեք դեպի Արենի և Նորավանք կամ համատեղեք Սևանա լիճն ու Դիլիջանը։ Երկար երթուղիները ներառում են Տաթևի վանքն ու ճոպանուղին։ Էքսկուրսիայի տևողությունն ու ընթացիկ գինը ցուցադրվում են մինչև ամրագրումը։',
    travelGuideToursLink: 'Բացահայտել Հայաստանի էքսկուրսիաները',
    travelGuidePlanningTitle: 'Ուղևորության գործնական պլանավորում',
    travelGuidePlanningText: 'Նշեք ձեր ամսաթվերը, խմբի չափն ու հետաքրքրությունները։ Մենք կօգնենք համադրել օդանավակայանի դիմավորումն ու Երևանում ձեր կեցությունը, առաջարկել ժամանակացույցին համապատասխան երթուղի և ընտրել մեկօրյա ուղևորություններ։ Գները ցուցադրվում են AMD-ով կամ փոխարկվում USD-ի՝ կայքի ընթացիկ փոխարժեքով։',
    travelGuidePlanningLink: 'Հարցում ուղարկել անհատական երթուղու համար',
    travelFaqTitle: 'Հաճախ տրվող հարցեր Հայաստան այցելելու մասին',
    travelFaqTransferQuestion: 'Կարո՞ղ եմ տրանսֆեր ամրագրել «Զվարթնոցից» Երևան',
    travelFaqTransferAnswer: 'Այո։ Ընտրեք «Զվարթնոց օդանավակայան — Երևան» երթուղին, ընտրեք սեդան կամ մինիվեն և ամրագրման ձևում նշեք ժամանման ժամը և չվերթի համարը։',
    travelFaqToursQuestion: 'Կարո՞ղ եմ Երևանից մեկօրյա ուղևորություններով այցելել Հայաստանի հայտնի վայրերը',
    travelFaqToursAnswer: 'Այո։ Էքսկուրսիաների ցանկում կան Գառնիի և Գեղարդի, Խոր Վիրապի ու Նորավանքի, Սևանա լճի և Դիլիջանի, ինչպես նաև այլ երթուղիներ։ Յուրաքանչյուր էքսկուրսիայի էջում ստուգեք տևողությունը, հասանելի ամսաթվերն ու գինը։',
    travelFaqPrivateQuestion: 'Կարո՞ղ եք կազմակերպել անհատական ուղևորություն Հայաստանում',
    travelFaqPrivateAnswer: 'Անհատական հարցման ձևում նշեք ուղևորության ամսաթվերը, խմբի չափը և նախընտրած վայրերը։ Մեր տեղական թիմը կառաջարկի երթուղի և հստակ գին։',
    customEyebrow: 'Ձեր ուղևորության համար', customTitle: 'Անհրաժե՞շտ է անհատական ծրագիր', customDescription: 'Պատմեք ձեր մտահղացման մասին։ Մեր թիմը կառաջարկի երթուղի և հստակ գին։'
  })
};

// Reference prices are stored in AMD; the public currency switch converts them using usd_rate.
const transferPriceDefaults = {
  'zvartnots-yerevan': [5850, 9750],
  'yerevan-zvartnots': [5850, 9750],
  'gyumri-yerevan': [29250, 39000],
  'yerevan-gyumri': [29250, 39000]
};
settings.transfer_routes = JSON.stringify(JSON.parse(settings.transfer_routes).map(route => ({
  ...route,
  sedan_amd: transferPriceDefaults[route.id]?.[0] ?? route.sedan_amd,
  minivan_amd: transferPriceDefaults[route.id]?.[1] ?? route.minivan_amd
})));
settings.transfer_extras = JSON.stringify(JSON.parse(settings.transfer_extras).map(extra => ({
  ...extra,
  price_amd: extra.id === 'child-seat' ? 1950 : extra.id === 'extra-stop' ? 3900 : extra.price_amd
})));

const legacyTourDefaults = [
  ['garni-geghard-symphony', 'Garni, Geghard and the Symphony of Stones', 24000, 'garni-geghard-monastery'],
  ['khor-virap-areni-wine', 'Khor Virap and Areni wine', 32000, 'khor-virap-areni-noravank'],
  ['dilijan-lake-sevan', 'Dilijan and Lake Sevan', 28000, 'lake-sevan-dilijan'],
  ['yerevan-food-walk', 'Yerevan food walk', 15000, 'yerevan-city-tour'],
  ['aragats-amberd', 'Mount Aragats and Amberd fortress', 36000, 'echmiadzin-zvartnots-ruins'],
  ['tatev-wings', 'Tatev and the Wings of Tatev', 79000, 'tatev-monastery-cable-car']
];
const legacyLandingCopy = {
  landing_copy_en: {
    flightNotificationTitle: 'Flight 417 landed',
    flightNotificationText: 'Your driver is waiting at the arrivals gate.',
    servicesDescription: 'Choose a service to see the details and plan your next step.',
    transferDescription: 'A relaxed welcome at Zvartnots or Gyumri, with a private ride to your Yerevan address.',
    toursDescription: 'Thoughtful local journeys through Armenia’s monasteries, mountain roads and food culture.',
    transferPanelDescription: 'Private rides, priced per car. Request a fixed quote.',
    tourPanelDescription: 'Small groups, local guides and current prices from our tour catalog.',
    whyDescription: 'The things you can count on from the moment you land.',
    customDescription: 'Tell us what you have in mind. Our local team will come back with a route and a clear price.'
  }
};

function migrateLegacyTourCatalog() {
  const readTour = db.prepare('SELECT * FROM tours WHERE slug=?');
  const snapshotBookingNames = db.prepare("UPDATE booking_items SET tour_name=? WHERE tour_id=? AND tour_name=''");
  const updateTour = db.prepare(`UPDATE tours SET slug=?,category=?,duration=?,price_amd=?,difficulty=?,sort_order=?,
    name_en=?,description_en=?,highlights_en=?,name_ru=?,description_ru=?,highlights_ru=?,name_hy=?,description_hy=?,highlights_hy=?
    WHERE id=?`);
  const migrate = db.transaction(() => {
    for (const [legacySlug, legacyName, legacyPrice, targetSlug] of legacyTourDefaults) {
      const oldTour = readTour.get(legacySlug);
      const target = tours.find(tour => tour.slug === targetSlug);
      if (!oldTour || !target || oldTour.name_en !== legacyName || oldTour.price_amd !== legacyPrice) continue;
      const translation = tourTranslations[targetSlug];
      snapshotBookingNames.run(oldTour.name_en, oldTour.id);
      updateTour.run(
        oldTour.slug, target.category, target.duration, target.price, target.difficulty, tours.indexOf(target),
        target.name, target.description, JSON.stringify(target.highlights),
        translation[0], translation[1], JSON.stringify(translation[2]),
        translation[3], translation[4], JSON.stringify(translation[5]), oldTour.id
      );
    }
  });
  migrate();
}

function migratePlaceholderTransferPrices() {
  const routeSetting = db.prepare('SELECT value FROM settings WHERE key=?').get('transfer_routes')?.value;
  if (routeSetting) {
    const routes = JSON.parse(routeSetting);
    if (routes.length && routes.every(route => Number(route.sedan_amd) === 0 && Number(route.minivan_amd) === 0)) {
      const defaults = new Map(JSON.parse(settings.transfer_routes).map(route => [route.id, route]));
      const priced = routes.map(route => {
        const fallback = defaults.get(route.id);
        return fallback ? { ...route, sedan_amd: fallback.sedan_amd, minivan_amd: fallback.minivan_amd } : route;
      });
      db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(priced), 'transfer_routes');
    }
  }
  const extrasSetting = db.prepare('SELECT value FROM settings WHERE key=?').get('transfer_extras')?.value;
  if (extrasSetting) {
    const extras = JSON.parse(extrasSetting);
    if (extras.length && extras.every(extra => Number(extra.price_amd) === 0)) {
      const priced = extras.map(extra => ({
        ...extra,
        price_amd: extra.id === 'child-seat' ? 1950 : extra.id === 'extra-stop' ? 3900 : extra.price_amd
      }));
      db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(priced), 'transfer_extras');
    }
  }
}

function migrateLegacyAddons() {
  const readAddon = db.prepare('SELECT * FROM addons WHERE id=?');
  const insertAddon = db.prepare('INSERT OR IGNORE INTO addons (id,name_en,name_ru,name_hy,price_amd,price_type) VALUES (?,?,?,?,?,?)');
  const updateAddon = db.prepare('UPDATE addons SET name_en=?,name_ru=?,name_hy=?,price_amd=?,price_type=? WHERE id=?');
  const bookingItems = db.prepare('SELECT addon_ids FROM booking_items').all();
  const isUsed = id => bookingItems.some(item => JSON.parse(item.addon_ids || '[]').includes(id));

  const oldLunch = readAddon.get('lun');
  if (oldLunch?.name_en === 'Upgrade to chef’s lunch' && oldLunch.price_amd === 6000 && !isUsed('lun')) {
    updateAddon.run(...addons[0].slice(1), 'lun');
  }
  for (const [id, oldName, oldPrice] of [
    ['drv', 'Private car instead of group van', 30000],
    ['pho', 'Photographer for the day', 25000]
  ]) {
    const addon = readAddon.get(id);
    if (addon?.name_en === oldName && addon.price_amd === oldPrice && !isUsed(id)) {
      db.prepare('UPDATE addons SET active=0 WHERE id=?').run(id);
    }
  }
  insertAddon.run(...addons[1]);
}

export function seedDatabase() {
  const isEmpty = db.prepare('SELECT COUNT(*) AS count FROM tours').get().count === 0;
  if (!isEmpty) {
    ensureOwner();
    const putSetting = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
    const readSetting = db.prepare('SELECT value FROM settings WHERE key=?');
    for (const [key, value] of Object.entries(settings)) {
      if (!key.startsWith('landing_copy_')) {
        putSetting.run(key, value);
        continue;
      }
      const existing = readSetting.get(key)?.value;
      if (existing) {
        const defaults = JSON.parse(value);
        const previous = JSON.parse(existing);
        for (const [field, legacyText] of Object.entries(legacyLandingCopy[key] || {})) {
          if (previous[field] === legacyText) previous[field] = defaults[field];
        }
        const merged = { ...defaults, ...previous };
        db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(merged), key);
      } else {
        putSetting.run(key, value);
      }
    }
    migrateLegacyTourCatalog();
    migratePlaceholderTransferPrices();
    migrateLegacyAddons();
    const currentHeroText = readSetting.get('hero_text')?.value;
    if (currentHeroText === 'Small-group tours, private drives and workshops across Armenia. Book in minutes.') {
      db.prepare('UPDATE settings SET value=? WHERE key=?').run(settings.hero_text, 'hero_text');
    }
    return false;
  }
  const addTour = db.prepare(`INSERT INTO tours
    (slug,category,duration,price_amd,difficulty,max_group,status,sort_order,name_en,description_en,highlights_en,name_ru,description_ru,highlights_ru,name_hy,description_hy,highlights_hy)
    VALUES (@slug,@category,@duration,@price,@difficulty,8,'published',@sort_order,@name,@description,@highlights,@name_ru,@description_ru,@highlights_ru,@name_hy,@description_hy,@highlights_hy)`);
  const addDeparture = db.prepare('INSERT INTO tour_departures (tour_id,date,seats_total) VALUES (?,?,?)');
  const today = new Date();
  const makeDepartures = db.transaction(() => tours.forEach((tour, index) => {
    const info = addTour.run({ ...tour, sort_order: index, highlights: JSON.stringify(tour.highlights), name_ru: '', description_ru: '', highlights_ru: '[]', name_hy: '', description_hy: '', highlights_hy: '[]' });
    for (let day = 3 + index % 4; day <= 90; day += 7) {
      const date = new Date(today);
      date.setDate(date.getDate() + day);
      addDeparture.run(info.lastInsertRowid, date.toISOString().slice(0, 10), tour.slug === 'lori-dilijan-trekking-week' ? 8 : 12);
    }
  }));
  makeDepartures();
  const updateTranslation = db.prepare('UPDATE tours SET name_ru=?,description_ru=?,highlights_ru=?,name_hy=?,description_hy=?,highlights_hy=? WHERE slug=?');
  for (const [slug, values] of Object.entries(tourTranslations)) {
    updateTranslation.run(values[0], values[1], JSON.stringify(values[2]), values[3], values[4], JSON.stringify(values[5]), slug);
  }
  const addAddon = db.prepare('INSERT INTO addons (id,name_en,name_ru,name_hy,price_amd,price_type) VALUES (?,?,?,?,?,?)');
  addons.forEach(addon => addAddon.run(...addon));
  const addService = db.prepare(`INSERT INTO services (name_en,description_en,name_ru,description_ru,name_hy,description_hy,icon,sort_order)
    VALUES (?,?,?,?,?,?,?,?)`);
  services.forEach((service, index) => addService.run(...service, index));
  const putSetting = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  Object.entries(settings).forEach(([key, value]) => putSetting.run(key, value));
  const email = process.env.ADMIN_EMAIL;
  ensureOwner();
  return true;
}

function ensureOwner() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    db.prepare('INSERT OR IGNORE INTO admin_users (email,password_hash,role) VALUES (?,?,?)')
      .run(email.toLowerCase(), bcrypt.hashSync(password, 12), 'owner');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const created = seedDatabase();
  console.log(created ? 'Seed data created.' : 'Database already contains tours; seed skipped.');
}