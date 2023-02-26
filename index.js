const { chromium } = require("playwright");
const fetch = require("node-fetch");

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ?? "XXXXXXXXXX:XXXXXXXXXXXXXXXXXX-XXXXXXXXXXX";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "XXXXXXXXX";
const KVR_ID = process.env.KVR_ID ?? 1000102;
const headless = (process.env.HEADLESS ?? true) === true;
const kvrUrl =
  "https://terminvereinbarung.muenchen.de/sta/termin/index.php?cts=" + KVR_ID;

// either overwrite case type here or use KVR_CASE_TYPE_VARIABLE
const personCountSelector = `select[name="CASETYPES[${
  process.env.KVT_CASE_TYPE ?? "Kirchenaustritt erklären"
}]"]`;
const interval = 1000 * 60 * 30;

const sendMsg = async (msg, gif, fetchOptions = {}) => {
  fetchOptions.timeout = fetchOptions.timeout || 3000;

  let url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/`;

  if (gif) {
    url += `sendvideo?chat_id=${TELEGRAM_CHAT_ID}&caption=${encodeURIComponent(
      msg
    )}&video=${encodeURIComponent(gif)}`;
  } else {
    url += `sendmessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(
      msg
    )}`;
  }

  try {
    let response = await (await fetch(url, fetchOptions)).json();
    return response;
  } catch (e) {
    console.error(new Date().toLocaleString(), e.message);
    return false;
  }
};

const nothingFound = async () => {
  await sendMsg(
    "Nothing new yet \n" + Date().toLocaleString(),
    "https://tenor.com/2pw1.gif"
  );
  console.log("[log] no new entry found for date " + Date().toLocaleString());
};

const createFindFreeDates = (page) => async () => {
  await page.goto(kvrUrl);
  console.log("[log] fetching current state");
  await page.waitForSelector(personCountSelector);
  await page.selectOption(`${personCountSelector}`, "1");
  // console.debug("found person selector")
  await page.waitForSelector(".WEB_APPOINT_FORWARDBUTTON");
  await page.click(".WEB_APPOINT_FORWARDBUTTON");

  // wait for updated page to load
  await page.waitForSelector(".nat_calendar td.nat_calendar");
  const monthEntries = await page.$$("td.nat_calendar");

  console.log("[log] data loaded");
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
  const data = JSON.parse((await page.evaluate(() => jsonAppoints)) ?? "{}");
  if (Object.entries(data).length === 0) {
    await nothingFound();
    return;
  }
  //console.log(data)

  // select appointment data
  const appointments = Object.entries(data)[0][1].appoints;

  // all entries as a list of [[available, data]]
  let nonEmptyDays = Object.entries(appointments).filter(
    ([key, value]) => value.length !== 0
  );

  if (nonEmptyDays.length > 0) {
    const appointDisplayList = nonEmptyDays.reduce((acc, cur) => {
      return `${acc}\n${cur[0]} at ${cur[1].join(",")}`;
    }, "");

    console.log("[log] found entries " + appointDisplayList);
    await sendMsg("Found available dates: " + appointDisplayList);
  } else {
    await nothingFound();
  }
};

(async () => {
  console.log("[log] starting playwright with chromium backend");
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({});
  const page = await context.newPage();
  console.log("[log] browser running...");
  const findFreeDates = createFindFreeDates(page);
  findFreeDates();
  console.log("[log] started periodic check every " + interval + " seconds");
  setInterval(findFreeDates, interval);
})();
