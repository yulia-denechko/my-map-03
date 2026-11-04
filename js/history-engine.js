import { WorldData } from './data-store.js';
import {
  WorldState,
  activeWarsForYear,
  burnProgressForYear,
  findPoliticalChange,
  floodStateForYear,
  politicalEraForYear,
} from './world-state.js';

const OBSERVATIONS = [
  'весенние воды приносили ил на огороды, но размывали нижние мостки',
  'летние лодки шли по мелким протокам, а на сухих террасах закладывали зернохранилища',
  'осенний ветер сушил настилы переправ; лесные общины проверяли запасы смолы и дров',
  'ранний мороз закрывал тропы на перевалах и заставлял караваны держаться речных стоянок',
  'рыбаки отмечали новые отмели и передавали промеры городским писцам',
  'стража сверяла дорожные знаки с уровнем воды и переносила колышки к высокому берегу',
  'лесничие оставляли охранные полосы у родников, чтобы не лишить поселения чистой воды',
  'купцы пересчитывали пошлины на мостах и договаривались о совместном ремонте пристаней',
];

const LOCAL_WORK = [
  'чинит мостки на ближайшем броде',
  'обновляет общую сушильню для зерна и рыбы',
  'прокладывает лесную тропу к запасному источнику',
  'ставит размеченные колья на весеннем берегу',
  'ремонтирует пристань и хранит лодки выше обычной отметки',
  'составляет список колодцев и делит обязанности по их очистке',
  'ограждает лесной участок вокруг родника от бесконтрольной рубки',
];

const BORDER_WORK = [
  'согласует место для общего рынка у границы двух владений',
  'переносит дорожный пост с низкой переправы на сухой уступ',
  'назначает совместный караул для лесной дороги и речного брода',
  'проводит межевые знаки вдоль водораздела, а не по исчезающей пойме',
  'обновляет правила для рыбаков и сборщиков древесины на пограничной реке',
  'обсуждает, кто содержит пристань и маячную башню на новом берегу',
];

const yearLabel = year => year < 0 ? `${Math.abs(year)} год до н.э.` : year === 0 ? 'Год 0, День Шал-Кари' : `${year} год н.э.`;
const stableIndex = (year, length, offset = 0) => ((Math.abs(year + offset) % length) + length) % length;
const clamp = value => Math.max(0, Math.min(1, value));
const isSettlement = place => ['city', 'citadel', 'settlement', 'port'].includes(place.type);

export class AnnualChronicle {
  getYear(year) {
    const value = Math.max(-500, Math.min(500, Math.round(Number(year))));
    const epoch = WorldData.epochs.find(item => value >= item.startYear && value <= item.endYear) || WorldData.epochs[0];
    const water = floodStateForYear(value);
    const previousWater = floodStateForYear(value - 1);
    const wars = activeWarsForYear(value);
    const politics = politicalEraForYear(value);
    const change = findPoliticalChange(value);
    const knownPlaces = WorldData.locations.filter(place => place.foundedYear <= value);
    const knownSettlements = knownPlaces.filter(isSettlement);
    const newSettlements = knownPlaces.filter(place => place.foundedYear === value && isSettlement(place));
    const newlyLost = WorldData.locations.filter(place => place.floodYear === value && value >= 0);
    const activeSettlements = knownPlaces.filter(place => isSettlement(place) && (!place.floodYear || value < place.floodYear));
    const activeScar = WorldState.burnScars
      .map(scar => ({ ...scar, intensity: burnProgressForYear(scar, value) }))
      .filter(scar => scar.intensity > 0.04)
      .sort((a, b) => b.intensity - a.intensity)[0] || null;
    const growingZones = water.zones
      .map(zone => ({ ...zone, annualChange: zone.progress - (previousWater.zones.find(old => old.id === zone.id)?.progress || 0) }))
      .filter(zone => zone.annualChange > 0.0005)
      .sort((a, b) => b.annualChange * b.weight - a.annualChange * a.weight);
    const locationIndex = stableIndex(value, Math.max(knownSettlements.length, 1), 7);
    const focalPlace = knownSettlements[locationIndex] || knownPlaces[0] || WorldData.locations[0];
    const observation = OBSERVATIONS[stableIndex(value, OBSERVATIONS.length, 3)];
    const investment = LOCAL_WORK[stableIndex(value, LOCAL_WORK.length, 11)];
    const borderAction = BORDER_WORK[stableIndex(value, BORDER_WORK.length, 19)];
    const paragraphs = this._writeParagraphs({
      year: value, epoch, water, wars, politics, change, knownPlaces, newSettlements,
      newlyLost, activeSettlements, activeScar, growingZones, focalPlace,
      observation, investment, borderAction,
    });
    const title = change?.title || this._annualTitle(value, focalPlace, water, wars);

    return {
      year: value,
      label: yearLabel(value),
      title,
      paragraphs,
      epoch,
      water,
      wars,
      politics,
      change,
      newSettlements,
      activeSettlements,
      activeSettlementCount: activeSettlements.length,
      knownLocationCount: knownPlaces.length,
      newlyLost,
      activeScar,
      growingZones,
    };
  }

  _annualTitle(year, place, water, wars) {
    if (year === 0) return 'День Шал-Кари: первые часы разлома';
    if (wars.length) return `${wars[0].name}: лето ${year < 0 ? `${Math.abs(year)} до н.э.` : year}`;
    if (year < 0) return `Годовой свод ${Math.abs(year)} до н.э. · ${place.name}`;
    if (water.coverage < 0.12) return `Первая вода · ${place.name}`;
    if (water.coverage < 0.55) return `Новые берега · ${place.name}`;
    return `Летопись островных путей · ${place.name}`;
  }

  _writeParagraphs(context) {
    const {
      year, epoch, water, wars, politics, change, newSettlements, newlyLost,
      activeSettlements, activeScar, growingZones, focalPlace, observation,
      investment, borderAction,
    } = context;
    const paragraphs = [];
    const eventLead = change
      ? `${change.detail}`
      : `${observation[0].toLocaleUpperCase('ru')}${observation.slice(1)}.`;
    const politicalText = `На этот год карта показывает ${politics.territories.map(item => item.name).join(', ')}. ${politics.change}`;
    paragraphs.push(`${yearLabel(year)}. ${eventLead} ${politicalText}`);

    if (year < 0) {
      const reservoir = year < -120
        ? 'Ветх-Орн ещё держит основную массу льда; речные разливы остаются сезонными, поэтому склады и поселения тяготеют к террасам над обычной весенней отметкой.'
        : 'Ледник даёт всё более неровный сток. Вода пока не выходит из русел надолго, но писцы отмечают, что низкие мосты приходится чинить раньше обычного.';
      const moving = growingZones.length
        ? ` В летопись внесено изменение уровня в районе «${growingZones[0].name}»; его низкие берега сейчас ещё доступны для пашни.`
        : '';
      paragraphs.push(`${reservoir}${moving} ${observation}.`);
    } else {
      const delta = Math.max(0, water.percent - previousWater.percent);
      const advancing = growingZones.slice(0, 2).map(zone => `«${zone.name}» (${Math.round(zone.progress * 100)}% от будущей площади)`).join(' и ');
      const advancingText = advancing
        ? `Вода в этом году продвинулась прежде всего в ${advancing}.`
        : 'Вода пока не перешла в новый бассейн, но береговая отметка ещё меняется по сезонам.';
      const lostText = newlyLost.length
        ? ` В этом году оставлены ${newlyLost.map(place => place.name).join(', ')}: жители вынесли утварь на террасы, а уцелевшие стены стали первыми метками глубины.`
        : '';
      const eventYear = year === 0
        ? 'Первый прорыв не превращает весь материк в море: поток срывает ледяную плотину и заполняет русло ниже Зар-Каша; дальние поймы пока остаются сушей.'
        : `${advancingText} Сводная отметка будущих затопляемых низин составляет ${water.percent}%; за прошедший год площадь отмеченных вод изменилась примерно на ${delta} п.п. ${water.stage}.`;
      paragraphs.push(`${eventYear}${lostText} ${observation}.`);
    }

    if (newSettlements.length) {
      const foundations = newSettlements.map(place => `${place.name} закладывают у источника «${place.waterSource}», рядом с ресурсом — ${place.nearbyForest}. Первые дворы ставят на высокой террасе, чтобы сохранить доступ к воде и не занимать плодородную пойму.`).join(' ');
      paragraphs.push(`${foundations} В переписи теперь ${activeSettlements.length} действующих городов, портов, крепостей и поселений; рост идёт отдельными стоянками и не возникает сразу по всему берегу.`);
    } else {
      const oldSettlement = focalPlace;
      const settlementText = year < 0
        ? `Новых городов в этот год не учреждают. ${oldSettlement.name} живёт у ${oldSettlement.waterSource}; лесной ресурс — ${oldSettlement.nearbyForest} — даёт топливо, строительный лес и корм для скота.`
        : `Новой хартии поселения в этом году нет. Совет ${oldSettlement.name} ${investment}; так существующие дворы растут вокруг надёжного источника «${oldSettlement.waterSource}», а не появляются случайно в стороне от воды и леса.`;
      const evacuationText = newlyLost.length ? ' Плотники разбирают нижние пристани, пока их можно вывезти по сухой дороге.' : '';
      paragraphs.push(`${settlementText}${evacuationText} Всего на карте уже известно ${context.knownPlaces.length} мест, но постоянно населены только ${activeSettlements.length} из них.`);
    }

    if (wars.length) {
      const war = wars[0];
      const duration = year - war.startYear + 1;
      const phase = year === war.startYear
        ? `Войска входят в область: ${war.cause}. Первые столкновения идут у ${war.region}; обозы держатся воды и вырубают полосу обзора вдоль дороги.`
        : year === war.endYear
          ? `Война заканчивается: ${war.outcome}. Последний приказ требует прекратить поджоги, оставить колодцы нетронутыми и пропустить обозы с зерном.`
          : `Это ${duration}-й год кампании. Стороны спорят за переправы в области «${war.region}», а победа зависит от подвоза продовольствия по воде и лесным дорогам.`;
      const scarText = activeScar
        ? ` На месте боёв уже видна зона «${activeScar.name}»: выжженная площадь в этот год проявлена на карте примерно на ${Math.round(activeScar.intensity * 100)}%; молодая поросль вернётся лишь после долгого покоя.`
        : '';
      paragraphs.push(`${war.name} между сторонами: ${war.sides}. ${phase}${scarText} Летописец отмечает не только исход сражения, но и цену — сгоревшие амбары, потерянные мосты и семьи, которым придётся искать новую террасу.`);
    } else {
      const remembered = WorldState.burnScars
        .map(scar => ({ ...scar, recovery: burnProgressForYear(scar, year) }))
        .filter(scar => scar.recovery > 0.03)
        .sort((a, b) => b.recovery - a.recovery)[0];
      const borderMoment = change
        ? ` Писцы отмечают эту политическую перемену на новых межевых картах и проверяют, какие переправы переходят под общий надзор.`
        : `На рубеже владений ${borderAction}; межу ведут по хребту или верхней дороге, потому что водная кромка ненадёжна.`;
      const recoveryText = remembered
        ? ` Земля «${remembered.name}» всё ещё несёт следы огня. Контур выжженного участка постепенно сокращается, лесничие оставляют его без рубки до ${remembered.recoverYear < 0 ? `${Math.abs(remembered.recoverYear)} года до н.э.` : `${remembered.recoverYear} года`}.`
        : ' Открытых походов в этом году нет: силы уходят на ремонт дорог, устройство рынков и договоры о доступе к воде.';
      paragraphs.push(`${politicalText}${borderMoment}${recoveryText} Для жителей именно такие решения определяют, где можно безопасно селиться и кому принадлежит переправа.`);
    }

    return paragraphs;
  }
}