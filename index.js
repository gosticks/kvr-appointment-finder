const { chromium } = require('playwright');
const fetch = require('node-fetch');
const yaml = require('js-yaml');
const fs = require('fs');

const minInterval = 600000 // 1000 * 60 * 10 ms = 10 min

const sendMsg = async (conf, msg, gif, fetchOptions = {}) => {
  fetchOptions.timeout = fetchOptions.timeout || 3000;

  let url = `https://api.telegram.org/bot${conf.TelegramBotToken}/`;
  if (gif) {
    url += `sendvideo?chat_id=${conf.TelegramChatID}&caption=${encodeURIComponent(msg)}&video=${encodeURIComponent(gif)}`
  } else {
    url += `sendmessage?chat_id=${conf.TelegramChatID}&text=${encodeURIComponent(msg)}`
  }

  try {
    let response = await (await fetch(url, fetchOptions)).json();
    console.log("got telegram response", response)
    return response;
  } catch (e) {
    console.error(new Date().toLocaleString(), e.message);
    return false;
  }
}

const nothingFound = async (conf) => {
  await sendMsg(conf, 'Nothing new yet \n' + Date().toLocaleString(), "https://tenor.com/2pw1.gif")
  console.log("[log] no new entry found for date " + Date().toLocaleString())
}

const createFindFreeDates = (conf, page) => async () => {

  await page.goto(conf.Url)
  console.log("[log] fetching current state")

  // since they added captchas let's not bother them too much, simply wait for the next time window
  try {
    const captcha = page.getByText('Sicherheitsabfrage', { exact: true });
    await captcha.waitFor({ timeout: 2000 });
    if (await captcha.count() > 0) {
      // await page.pause();// debugging
      console.log("[error] found a security question. waiting for next execution");
      return
    }
  } catch (e) { }

  console.log('[log] no captcha found, continuing')

  // try to find the count selector. on some pages it is invisible by default on others it is visibel from the get go -.-
  try {
    await page.waitForSelector(conf.PersonCountSelector, { timeout: 300 });
  } catch (e) {
    console.log("[debug] unable to find selector: ", e);
    console.log("[debug] toggling anchors", conf.PersonCountSelector);

    // try to toggle all the toggles
    const anchors = page.locator('a:visible');
    const hrefs = await anchors.evaluateAll((as) => as.map((a) => a.href).filter((href) => href.match(/javascript:toggle/)));

    if (hrefs.length === 0) {
      console.log("[error] unable to find anchors");
      return
    }

    console.log("[debug] hrefs", hrefs);
    for await (const href of hrefs) {
      await page.locator(`a[href="${decodeURI(href)}"]`).click();

      // on the B??rgerb??ro page there are some anchors that lead to a modal being displayed. We have to close it
      try {
        await page.click('.close:visible', { timeout: 300 });
        console.log("[debug] modal found and closed");
      } catch (e) {
        console.log("[debug] no modal found");
        // no modal -> nothing to do
      }
    }
  }

  await page.waitForSelector(conf.PersonCountSelector)
  await page.selectOption(`${conf.PersonCountSelector}`, "1")
  console.log("[debug] found person selector", conf.PersonCountSelector)
  await page.waitForSelector(".WEB_APPOINT_FORWARDBUTTON")
  await page.click(".WEB_APPOINT_FORWARDBUTTON")

  // for citizens' offices (B??rgerb??ros) we also need to select a place
  let co = conf.CitizensOffice ?? "";
  if (co !== "") {
    // select a matching citizens office
    try {
      await page.locator(`input[value="` + co + `"]`).click();
      console.log("[debug] citizens office found and selected")
    } catch (e) {
      console.log("[error] citizens office cannot be found: ", co)
    }
  }

  // wait for updated page to load
  await page.waitForSelector(".nat_calendar td.nat_calendar")
  await page.$$("td.nat_calendar")

  console.log("[log] data loaded")
  // data has type
  /*
  {
    'Wartezone Kirchenaustritte': {
      caption: 'Standesamt Ruppertstrasse',
      appoints: {
        '2022-12-02': [],
        ...
        '2023-01-07': [],
        '2023-01-08': [],
        '2023-01-09': [],
        '2023-01-10': [],
        '2023-01-11': [],
        '2023-01-12': [],
        '2023-01-13': [],
        '2023-01-14': [],
        '2023-01-15': [],
        '2023-01-16': [],
        '2023-01-17': [ '14:15', '14:30', '14:35', '14:40' ],
   
      },
      id: '39e1ede3e0400c55c6385221c42cfe23'
    }
  }
  */
  const data = JSON.parse(await page.evaluate(() => jsonAppoints) ??
    "{}")
  if (Object.entries(data).length === 0) {
    await nothingFound()
    return
  }
  console.log(data)

  // select appointment data
  const appointments = Object.entries(data)[0][1].appoints


  // all entries as a list of [[available, data]]
  let nonEmptyDays = Object.entries(appointments).filter(([key, value]) => value.length !== 0)


  if (nonEmptyDays.length > 0) {
    const appointDisplayList = nonEmptyDays.reduce((acc, cur) => {
      return `${acc}\n${cur[0]} at ${cur[1].join(",")}`
    }, "")

    console.log("[log] found entries " + appointDisplayList)
    await sendMsg(conf, 'Found available dates: ' + appointDisplayList, "https://tenor.com/bKqEb.gif");
  } else {
    await nothingFound(conf)
  }
}

const loadConfig = (path) => {
  let conf = {}
  try {
    conf = yaml.load(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    throw e
  }

  if (conf.Interval < minInterval) {
    throw "please choose a bigger interval (>" + minInterval / (1000 * 60) + "min)";
  }

  let appointmentTypeMap = new Map([
    // Standesamt
    // ~ Standesamt
    ["Kirchenaustritt erkl??ren", { Selector: "Kirchenaustritt erkl??ren", Url: "https://terminvereinbarung.muenchen.de/sta/termin/index.php" }],
    ["Beratungsgespr??ch Eheanmeldeverfahren", { Selector: "Beratungsgespr??ch Eheanmeldeverfahren", Url: "https://terminvereinbarung.muenchen.de/sta/termin/index.php" }],
    ["Eheanmeldung ohne Auslandsbezug", { Selector: "Eheanmeldung ohne Auslandsbezug", Url: "https://terminvereinbarung.muenchen.de/sta/termin/index.php" }],
    ["Eheanmeldung mit Auslandsbezug", { Selector: "Eheanmeldung mit Auslandsbezug", Url: "https://terminvereinbarung.muenchen.de/sta/termin/index.php" }],
    ["Erkl??rung Reihenfolge Vornamen", { Selector: "Erkl??rung Reihenfolge Vornamen", Url: "https://terminvereinbarung.muenchen.de/sta/termin/index.php" }],
    ["Erkl??rung 3. Geschlecht", { Selector: "Erkl??rung 3. Geschlecht", Url: "https://terminvereinbarung.muenchen.de/sta/termin/index.php" }],

    // ~ Standesamt Pasing
    ["Kirchenaustritt erkl??ren (Standesamt Pasing)", { Selector: "Kirchenaustritt erkl??ren (Standesamt Pasing)", Url: "https://terminvereinbarung.muenchen.de/sta/termin/index.php" }],
    ["Beratungsgespr??ch Eheanmeldeverfahren (Standesamt Pasing)", { Selector: "Beratungsgespr??ch Eheanmeldeverfahren (Standesamt Pasing)", Url: "https://terminvereinbarung.muenchen.de/sta/termin/index.php" }],
    ["Eheanmeldung ohne Auslandsbezug (Standesamt Pasing)", { Selector: "Eheanmeldung ohne Auslandsbezug (Standesamt Pasing)", Url: "https://terminvereinbarung.muenchen.de/sta/termin/index.php" }],
    ["Eheanmeldung mit Auslandsbezug (Standesamt Pasing)", { Selector: "Eheanmeldung mit Auslandsbezug (Standesamt Pasing)", Url: "https://terminvereinbarung.muenchen.de/sta/termin/index.php" }],
    ["Erkl??rung Reihenfolge Vornamen (Standesamt Pasing)", { Selector: "Erkl??rung Reihenfolge Vornamen (Standesamt Pasing)", Url: "https://terminvereinbarung.muenchen.de/sta/termin/index.php" }],
    ["Erkl??rung 3. Geschlecht (Standesamt Pasing)", { Selector: "Erkl??rung 3. Geschlecht (Standesamt Pasing)", Url: "https://terminvereinbarung.muenchen.de/sta/termin/index.php" }],


    // F??hrerscheinstelle
    // ~ Internationaler F??hrerschein
    ["Internationalen F??hrerschein mit vorherigem Tausch in Kartenf??hrerschein beantragen", { Selector: "FS Internationaler FS beantragen", Url: "https://terminvereinbarung.muenchen.de/fs/termin/index.php" }],
    ["Internationaler F??hrerschein bei Besitz eines Kartenf??hrerscheins", { Selector: "FS Internationaler FS bei Besitz", Url: "https://terminvereinbarung.muenchen.de/fs/termin/index.php" }],

    // ~ Umschreibung eines ausl??ndischen F??hrerscheins 
    ["Umschreibung eines ausl??ndischen F??hrerscheins (kein EU/EWR-F??hrerschein) beantragen", { Selector: "FS Umschreibung Ausl??ndischer FS", Url: "https://terminvereinbarung.muenchen.de/fs/termin/index.php" }],

    // ~ F??hrerschein zur Fahrgastbef??rderung 
    ["Ersatz Personenbef??rderungsschein wegen Verlust / Diebstahl", { Selector: "FS Ersatz PBS", Url: "https://terminvereinbarung.muenchen.de/fs/termin/index.php" }],

    // ~ Umschreibung Dienstf??hrerschein 
    ["Dienstf??hrerschein umschreiben", { Selector: "FS Dienstf??hrerschein umschreiben", Url: "https://terminvereinbarung.muenchen.de/fs/termin/index.php" }],

    // ~ Abholung F??hrerschein 
    ["Abholen eines internationalen F??hrerscheins bei Besitz eines Kartenf??hrerscheins", { Selector: "FS Internationaler FS bei Besitz", Url: "https://terminvereinbarung.muenchen.de/fs/termin/index.php" }],// this actually the same as when applying for an international license
    ["Abholung eines F??hrerscheines", { Selector: "FS Abholung F??hrerschein", Url: "https://terminvereinbarung.muenchen.de/fs/termin/index.php" }],
    ["Abholung eines Personenbef??rderungsscheines", { Selector: "FS Abholung eines Personenbef??rderungsscheines", Url: "https://terminvereinbarung.muenchen.de/fs/termin/index.php" }],


    // B??rgerb??ro
    // ~ Meldeangelegenheiten
    ["An- oder Ummeldung - Einzelperson", { Selector: "An- oder Ummeldung - Einzelperson", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["An- oder Ummeldung - Einzelperson mit eigenen Fahrzeugen", { Selector: "An- oder Ummeldung - Einzelperson mit eigenen Fahrzeugen", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["An- oder Ummeldung - Familie", { Selector: "An- oder Ummeldung - Familie", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["An- oder Ummeldung - Familie mit eigenen Fahrzeugen", { Selector: "An- oder Ummeldung - Familie mit eigenen Fahrzeugen", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Meldebescheinigung", { Selector: "Meldebescheinigung", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Haushaltsbescheinigung", { Selector: "Haushaltsbescheinigung", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Familienstands??nderung/ Namens??nderung", { Selector: "Familienstands??nderung/ Namens??nderung", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],

    // ~ Ausweisdokumente
    ["Antrag Personalausweis", { Selector: "Antrag Personalausweis", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Antrag Reisepass/Expressreisepass", { Selector: "Antrag Reisepass/Expressreisepass", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Antrag vorl??ufiger Reisepass", { Selector: "Antrag vorl??ufiger Reisepass", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Antrag oder Verl??ngerung/Aktualisierung Kinderreisepass", { Selector: "Antrag oder Verl??ngerung/Aktualisierung Kinderreisepass", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Ausweisdokumente - Familie (Minderj??hrige und deren gesetzlicheVertreter)", { Selector: "Ausweisdokumente - Familie (Minderj??hrige und deren gesetzliche Vertreter)", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["eID-Karte beantragen (EU/EWR)", { Selector: "eID-Karte beantragen (EU/EWR)", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Nachtr??gliche Anschriften??nderung Personalausweis/Reisepass/eAT", { Selector: "Nachtr??gliche Anschriften??nderung Personalausweis/Reisepass/eAT", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Nachtr??gliches Einschalten eID / Nachtr??gliche ??nderung PIN", { Selector: "Nachtr??gliches Einschalten eID / Nachtr??gliche ??nderung PIN", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Widerruf der Verlust- oder Diebstahlanzeige von Personalausweis oder Reisepass", { Selector: "Widerruf der Verlust- oder Diebstahlanzeige von Personalausweis oder Reisepass", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Verlust- oder Diebstahlanzeige von Personalausweis", { Selector: "Verlust- oder Diebstahlanzeige von Personalausweis", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Verlust- oder Diebstahlanzeige von Reisepass", { Selector: "Verlust- oder Diebstahlanzeige von Reisepass", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],

    // ~ Abholung Ausweisdokumente (Personalausweise, Reisep??sse, eID-Karten) 
    ["Personalausweis, Reisepass oder eID-Karte abholen", { Selector: "Personalausweis, Reisepass oder eID-Karte abholen", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],

    // ~ Bundeszentralregisterauskunft (Auskunft Gewerbezentralregister) 
    ["F??hrungszeugnis beantragen", { Selector: "F??hrungszeugnis beantragen", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Gewerbezentralregisterauskunft beantragen ??? nat??rliche Person", { Selector: "Gewerbezentralregisterauskunft beantragen ??? nat??rliche Person", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Gewerbezentralregisterauskunft beantragen ??? juristische Person", { Selector: "Gewerbezentralregisterauskunft beantragen ??? juristische Person", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],

    // ~ Beglaubigungen
    ["Bis zu 5 Beglaubigungen Unterschrift", { Selector: "Bis zu 5 Beglaubigungen Unterschrift", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Bis zu 5 Beglaubigungen Dokument", { Selector: "Bis zu 5 Beglaubigungen Dokument", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Bis zu 20 Beglaubigungen", { Selector: "Bis zu 20 Beglaubigungen", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],

    // ~ Zulassungsangelegenheiten
    ["Fahrzeug wieder anmelden [Zulassungsangelegenheiten]", { Selector: "Fahrzeug wieder anmelden", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Fahrzeug au??er Betrieb setzen", { Selector: "Fahrzeug au??er Betrieb setzen", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Adress??nderung in Fahrzeugpapiere eintragen lassen [Zulassungsangelegenheiten]", { Selector: "Adress??nderung in Fahrzeugpapiere eintragen lassen", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],
    ["Namens??nderung in Fahrzeugpapiere eintragen lassen", { Selector: "Namens??nderung in Fahrzeugpapiere eintragen lassen", Url: "https://terminvereinbarung.muenchen.de/bba/termin/index.php" }],


    // Versicherungsamt
    // ~ Rentenauskunft
    ["Auskunft Rente", { Selector: "Auskunft Rente", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Auskunft Hinterbliebenenrente", { Selector: "Auskunft Hinterbliebenenrente", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Rentenberechnung", { Selector: "Rentenberechnung", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Widerspruch", { Selector: "Widerspruch", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Wartezeitauskunft", { Selector: "Wartezeitauskunft", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Beitr??ge", { Selector: "Beitr??ge", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Sonstiges RV", { Selector: "Sonstiges RV", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],

    // ~ Auskunft KW, UV, RV
    ["Auskunft KVdR", { Selector: "Auskunft KVdR", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Familienversicherung", { Selector: "Familienversicherung", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["KV f??r Selbst??ndige", { Selector: "KV f??r Selbst??ndige", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["KV f??r Studenten", { Selector: "KV f??r Studenten", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Personen ohne KV", { Selector: "Personen ohne KV", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Krankengeld", { Selector: "Krankengeld", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Beitragsrecht", { Selector: "Beitragsrecht", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Sonstiges KV", { Selector: "Sonstiges KV", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Auskunft PV", { Selector: "Auskunft PV", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Soziale Absicherung von Pflegepersonen", { Selector: "Soziale Absicherung von Pflegepersonen", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Schwerbehindertenausweis", { Selector: "Schwerbehindertenausweis", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],

    // ~ Rentenantr??ge
    ["Kontenkl??rung", { Selector: "Kontenkl??rung", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Altersrente", { Selector: "Altersrente", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Rente wegen teilweiser oder voller Erwerbsminderung", { Selector: "Rente wegen teilweiser oder voller Erwerbsminderung", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Hinterbliebenenrente", { Selector: "Hinterbliebenenrente", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Antrag auf Beitragserstattung", { Selector: "Antrag auf Beitragserstattung", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Antrag aufmedizinische Rehabilitation", { Selector: "Antrag auf medizinische Rehabilitation", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],
    ["Lebensbescheinigung", { Selector: "Lebensbescheinigung", Url: "https://terminvereinbarung.muenchen.de/va/termin/index.php" }],


    // Amt f??r Ausbildungsf??rderung
    // ~ Dienleistungen des AfA
    ["Allgemeine Beratung", { Selector: "Allgemeine Beratung", Url: "https://terminvereinbarung.muenchen.de/afa/termin/index.php" }],
    ["Antrag abgeben", { Selector: "Antrag abgeben, besprechen und sichten", Url: "https://terminvereinbarung.muenchen.de/afa/termin/index.php" }],
    ["Unterlagen nachreichen", { Selector: "Unterlagen nachreichen", Url: "https://terminvereinbarung.muenchen.de/afa/termin/index.php" }],


    // KFZ-Zulassungsstelle
    // ~ Zulassung
    ["Fabrikneues Fahrzeug anmelden (mit deutschen Fahrzeugpapieren oder CoC) [Zulassung]", { Selector: "ZUL Fabrikneues Fahrzeug", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Fahrzeug umschreiben innerhalb M??nchens", { Selector: "ZUL Umschreibung innerhalb [Zulassung]", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Fahrzeug umschreiben von au??erhalb nach M??nchen [Zulassung]", { Selector: "ZUL Umschreibung au??erhalb", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Fahrzeug wieder anmelden [Zulassung]", { Selector: "ZUL Wiederanmeldung", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Vorabzuteilung eines Kennzeichens (z.B. f??r Fahrten zur Pr??forganisation)", { Selector: "ZUL Vorabzuteilung", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],

    // ~ Leasing/Finanzierung (Fahrzeugbrief (ZBII) liegt Ihnen nicht vor) 
    ["Fabrikneues Fahrzeug anmelden (mit deutschen Fahrzeugpapieren oder CoC) [Leasing/Finanzierung]", { Selector: "LEAS Fabrikneues Fahrzeug", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Fahrzeug umschreiben innerhalb M??nchens [Leasing/Finanzierung]", { Selector: "LEAS Umschreibung innerhalb", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Fahrzeug umschreiben von au??erhalb nach M??nchen [Leasing/Finanzierung]", { Selector: "LEAS Umschreibung au??erhalb", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Fahrzeug wieder anmelden [Leasing/Finanzierung]", { Selector: "LEAS Wiederanmeldung", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Adress??nderung in Fahrzeugpapiere eintragen lassen [Leasing/Finanzierung]", { Selector: "LEAS Adress??nderung", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Namens??nderung in Fahrzeugpapiere eintragen lassen [Leasing/Finanzierung]", { Selector: "LEAS Namens??nderung", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Technische ??nderung in Fahrzeugpapiere eintragen lassen [Leasing/Finanzierung]", { Selector: "LEAS Technische ??nderung", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Saisonkennzeichen beantragen [Leasing/Finanzierung]", { Selector: "LEAS Saisonkennzeichen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Wechselkennzeichen [Leasing/Finanzierung]", { Selector: "LEAS Wechselkennzeichen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Verlust oder Diebstahl der Zulassungsbescheinigung Teil I [Leasing/Finanzierung]", { Selector: "LEAS Verlust Zulassungsbescheinigung Teil I", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Verlust oder Diebstahl der Kennzeichenschilder [Leasing/Finanzierung]", { Selector: "LEAS Verlust Kennzeichen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],

    // ~ Import
    ["Aus dem Ausland eingef??hrtes fabrikneues Fahrzeug anmelden", { Selector: "ZUL IS Einfuhr Neu Ausland", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Aus dem Ausland eingef??hrtes gebrauchtes Fahrzeug anmelden", { Selector: "ZUL IS Einfuhr Gebraucht Ausland", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Kurzzeitkennzeichen f??r Fahrzeuge mit ausl??ndischen", { Selector: "ZUL IS Kurzzeitkennzeichen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Vorabzuteilung eines Kennzeichens (z.B. f??r Fahrten zur Pr??forganisation", { Selector: "ZUL IS Vorbereitung Kennzeichen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Zulassung eines selbstgebauten Neufahrzeuges", { Selector: "ZUL IS Eigenbauten Gutachten", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],

    // ~ ??nderung der Fahrzeugpapiere
    ["Adress??nderung in Fahrzeugpapiere eintragen lassen [??nderung der Fahrzeugpapiere]", { Selector: "ZUL Adress??nderung", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Namens??nderung in Fahrzeugpapiere eintragen lassen [??nderung der Fahrzeugpapiere]", { Selector: "ZUL Namens??nderung", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Technische ??nderung in Fahrzeugpapiere eintragen lassen [??nderung der Fahrzeugpapiere]", { Selector: "ZUL Technische ??nderung", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],

    // ~ Fahrzeugregister
    ["Auskunft aus dem Fahrzeugregister beantragen", { Selector: "ZUL Auskunft", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Halter- und Datenbest??tigungen f??r ein Kraftfahrzeug beantragen", { Selector: "ZUL Halter- und Datenbest??tigung", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],

    // ~ Besondere Kennzeichen
    ["Saisonkennzeichen beantragen [Besondere Kennzeichen]", { Selector: "ZUL Saisonkennzeichen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Kurzzeitkennzeichen beantragen", { Selector: "ZUL Kurzzeitkennzeichen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Wechselkennzeichen [Besondere Kennzeichen]", { Selector: "ZUL Wechselkennzeichen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Historisches Kennzeichen f??r Oldtimer beantragen", { Selector: "ZUL Historisches Kennzeichen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Rotes Dauerkennzeichen f??r Oldtimer beantragen -", { Selector: "ZUL Rotes Dauerkennzeichen f??r Oldtimer beantragen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Rote Dauerkennzeichen f??r Handel und Handwerk -", { Selector: "ZO Rote Dauerkennzeichen f??r Handel und Handwerk", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Ausfuhrkennzeichen", { Selector: "ZO Ausfuhrkennzeichen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],

    // ~ Verlust oder Diebstahl
    ["Verlust oder Diebstahl der Zulassungsbescheinigung Teil I [Verlust oder Diebstahl]", { Selector: "ZUL Verlust Zulassungsbescheinigung Teil I", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Verlust oder Diebstahl der Zulassungsbescheinigung Teil II [Verlust oder Diebstahl]", { Selector: "ZUL Verlust Zulassungsbescheinigung Teil II", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Verlust oder Diebstahl der Kennzeichenschilder [Verlust oder Diebstahl]", { Selector: "ZUL Verlust Kennzeichen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],

    // ~ Fahrzeug abmelden
    ["Abmeldung", { Selector: "ABS Au??erbetriebsetzung", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Abmeldung mit Verlust oder Diebstahl der Zulassungsbescheinigung Teil I", { Selector: "ABS Au??erbetriebsetzung mit Verlust oder Diebstahl der Zulassungsbescheinigung Teil I", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],
    ["Abmeldung mit Verlust oder Diebstahl der Kennzeichen", { Selector: "ABS Au??erbetriebsetzung mit Verlust oder Diebstahl Kennzeichen", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],

    // ~ Versicherungen
    ["Bearbeitung von Steuer- und Versicherungsangelegenheiten", { Selector: "VER Bearbeitung von Steuer- und Versicherungsangelegenheiten", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],

    // ~ Ausw??rtige Autoh??user
    ["Kfz Angelegenheiten f??r ausw??rtige Autoh??user", { Selector: "AUSW Kombi", Url: "https://terminvereinbarung.muenchen.de/kfz/termin/index.php" }],


    // Mietspiegel - ??berpr??fung Mieterh??hung
    // ~ Dienstleistungen des Amtes f??r Wohnen und Migration 
    ["Pr??fung Mieterh??hung", { Selector: "Pr??fung Mieterh??hung", Url: "https://terminvereinbarung.muenchen.de/soz/termin/index.php" }],


    // Elternberatungsstelle
    // ~ Alle Dienstleistungen
    ["Kurzberatung - Nachfrage zum Bearbeitungsstand", { Selector: "Allgemeine Kurzberatung", Url: "https://terminvereinbarung.muenchen.de/ebs/termin/index.php" }],
    ["Umfassende Beratung - Wie bekomme ich einen Kita-Platz f??r mein Kind ?", { Selector: "Umfassende Beratung zur Betreungsplatzsuche", Url: "https://terminvereinbarung.muenchen.de/ebs/termin/index.php" }],
  ]);

  // ensure the configuration is valid
  if (!appointmentTypeMap.has(conf.AppointmentType)) {
    throw "invalid appointment type: " + conf.appointmentType;
  }
  conf.PersonCountSelector = `select[name="CASETYPES[` + appointmentTypeMap.get(conf.AppointmentType).Selector + `]"]`;
  conf.Url = appointmentTypeMap.get(conf.AppointmentType).Url;

  conf.CitizensOffice = conf.CitizensOffice ?? ""
  if (conf.CitizensOffice !== "") {
    conf.CitizensOffice = "B??rgerb??ro " + conf.CitizensOffice;
  }

  if (appointmentTypeMap.get(conf.AppointmentType).Url === "https://terminvereinbarung.muenchen.de/bba/termin/index.php") {
    if (conf.CitizensOffice === "") {
      throw "appointment in citizens's office but not location given: " + conf.appointmentType;
    }
  } else {
    // set the value to be empty so the selection will be skipped later on
    conf.CitizensOffice = ""
  }

  console.debug(conf);

  return conf
}

(async () => {
  console.log("[log] reading config")
  try {
    const conf = loadConfig('./config.yaml')
    console.log("[log] starting playwright with chromium backend")
    let headless = conf.Headless
    const browser = await chromium.launch({ headless })
    const context = await browser.newContext({})
    const page = await context.newPage()
    console.log("[log] browser running...")
    const findFreeDates = createFindFreeDates(conf, page)
    findFreeDates()
    console.log("[log] started periodic check every " + conf.Interval / 1000 + " seconds")
    setInterval(findFreeDates, conf.Interval)

  } catch (e) {
    console.log(e)
  }

})()