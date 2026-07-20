import assert from "node:assert/strict";
import test from "node:test";

import { analyzeVacancyCard, extractVacancyDetails } from "../src/services/vacancyDetailsExtractor";

test("extractVacancyDetails reads explicit russian and english fields", () => {
  const details = extractVacancyDetails(
    "Senior Frontend Developer",
    [
      "Компания: Acme",
      "Salary: $4 000-5 500",
      "Грейд: Senior",
      "Формат работы: Remote",
      "Location: Europe",
      "Стек: React, TypeScript, Next.js"
    ].join("\n")
  );

  assert.deepEqual(details.company, { value: "Acme", confidence: "explicit" });
  assert.deepEqual(details.salary, { value: "$4 000-5 500", confidence: "explicit" });
  assert.deepEqual(details.grade, { value: "Senior", confidence: "explicit" });
  assert.deepEqual(details.workFormat, { value: "Remote", confidence: "explicit" });
  assert.deepEqual(details.geography, { value: "Europe", confidence: "explicit" });
  assert.deepEqual(details.stack, { value: "React, TypeScript, Next.js", confidence: "explicit" });
});

test("extractVacancyDetails marks inferred free-text values as uncertain", () => {
  const details = extractVacancyDetails(
    "Senior Frontend Developer",
    "Компания ищет разработчика в компанию Acme. Remote. React TypeScript. Зарплата до 3000 USD."
  );

  assert.equal(details.role?.confidence, "inferred");
  assert.equal(details.grade?.value, "Senior");
  assert.equal(details.grade?.confidence, "inferred");
  assert.equal(details.workFormat?.value, "Remote");
  assert.equal(details.stack?.confidence, "inferred");
  assert.equal(details.salary?.confidence, "inferred");
});

test("extractVacancyDetails hides conflicting inferred values", () => {
  const details = extractVacancyDetails(
    "Developer",
    "Подойдёт Junior или Senior разработчик. Возможен remote или офис."
  );

  assert.equal(details.grade, undefined);
  assert.equal(details.workFormat, undefined);
});

test("extractVacancyDetails does not infer React from reactivation", () => {
  const details = extractVacancyDetails("Cross-sell Manager", "Cross-sell Manager (reactivation). Remote.");

  assert.equal(details.stack, undefined);
});

test("extractVacancyDetails tolerates unstructured posts", () => {
  const details = extractVacancyDetails("Новая вакансия", "Пишите в личку, расскажу подробнее.");

  assert.equal(details.company, undefined);
  assert.equal(details.salary, undefined);
  assert.equal(details.stack, undefined);
});

test("extractVacancyDetails reads frequent employment, engagement and location labels", () => {
  const details = extractVacancyDetails(
    "Senior Frontend Developer",
    [
      "Заработная плата: 300 000-400 000 ₽ в месяц",
      "Занятость: Full-time",
      "Оформление: ТК РФ",
      "Локация работы: РФ и РБ",
      "Уровень английского: B2",
      "Таймзона: UTC+3"
    ].join("\n")
  );

  assert.equal(details.salary?.value, "300 000-400 000 ₽ в месяц");
  assert.equal(details.employment?.value, "Full-time");
  assert.equal(details.engagement?.value, "ТК РФ");
  assert.equal(details.geography?.value, "РФ и РБ");
  assert.equal(details.english?.value, "B2");
  assert.equal(details.timeZone?.value, "UTC+3");
});

test("extractVacancyDetails infers conservative geography from short title and line segments", () => {
  const office = extractVacancyDetails(
    "DevOps-инженер в стрим АиВ",
    ["#офис", "Нижний Новгород", "Компания: Т1"].join("\n")
  );
  const titleLocation = extractVacancyDetails(
    "Лучшее на hh:Директор по маркетингу в сеть кофеен Шоколадница (Москва)",
    "Сеть кофеен Шоколадница — одна из крупнейших компаний."
  );
  const pipeLocation = extractVacancyDetails(
    "Graphic Designer | Сербия, удалённо",
    "Full-time. English B2."
  );
  const englishLocation = extractVacancyDetails(
    "Head of Legal | Limassol",
    "International payment company is looking for Head of Legal."
  );

  assert.equal(office.geography?.value, "Нижний Новгород");
  assert.equal(titleLocation.geography?.value, "Москва");
  assert.equal(pipeLocation.geography?.value, "Сербия");
  assert.equal(englishLocation.geography?.value, "Limassol");
});

test("extractVacancyDetails removes location-only pipe segments from role", () => {
  const remoteGeo = extractVacancyDetails("Graphic Designer | Сербия, удалённо", "Full-time. English B2.");
  const cityGeo = extractVacancyDetails("Head of Legal | Limassol", "International payment company.");

  assert.equal(remoteGeo.role?.value, "Graphic Designer");
  assert.equal(remoteGeo.geography?.value, "Сербия");
  assert.equal(cityGeo.role?.value, "Head of Legal");
  assert.equal(cityGeo.geography?.value, "Limassol");
});

test("extractVacancyDetails strips source prefixes and location suffixes from title company", () => {
  const details = extractVacancyDetails(
    "Лучшее на hh:Директор по маркетингу в сеть кофеен Шоколадница (Москва)",
    "Сеть кофеен Шоколадница — одна из крупнейших компаний."
  );

  assert.equal(details.role?.value, "Директор по маркетингу");
  assert.equal(details.company?.value, "Шоколадница");
  assert.equal(details.geography?.value, "Москва");
});

test("extractVacancyDetails reads negotiable and compact salary formats", () => {
  const negotiable = extractVacancyDetails(
    "Sales Manager",
    "Удаленка, зарплата после собеседования. B2B contract."
  );
  const compact = extractVacancyDetails(
    "Графический дизайнер",
    "💰 Вилка: от 40к ₽\n🏠 Формат: #удалёнка"
  );
  const monthly = extractVacancyDetails(
    "Контент-помощник",
    "Условия: Удаленка, свободный график, ведение 5 клиентов, оклад 12.000/мес."
  );

  assert.equal(negotiable.salary?.value, "по договоренности");
  assert.equal(compact.salary?.value, "от 40к ₽");
  assert.equal(monthly.salary?.value, "12.000/мес");
});

test("extractVacancyDetails reads explicit type as employment", () => {
  const details = extractVacancyDetails(
    "Material & 3D Environment Artist",
    "🛠 Тип: #Freelance#Outsource#Full-time"
  );

  assert.equal(details.employment?.value, "#Freelance#Outsource#Full-time");
});

test("extractVacancyDetails reads decorated agency posts with separate salary amount", () => {
  const details = extractVacancyDetails(
    "🔥 Project Manager / Аккаунт-менеджер (Middle), удалённо, digital-агентство Kodi-IT",
    [
      "О компании:",
      "🔶 Kodi-IT — digital-агентство с 2019 года.",
      "🔶 Ищем Project Manager, который сможет быть «единым окном» между клиентом и командой.",
      "",
      "Требования:",
      "🔶 Опыт в диджитал/маркетинговом агентстве от 2 лет",
      "🔶 Гео: Челябинск, Екатеринбург, Тюмень, Уфа, Пермь, Омск, Новосибирск, Красноярск (UTC+5±3 часа)",
      "🔶 Часовой пояс: Челябинск, Екатеринбург, Новосибирск, UTC+5 ±3 часа",
      "",
      "Мы предлагаем:",
      "🔶 Удалённую работу. График 9:00-18:00 по Челябинску (UTC+5)",
      "",
      "Зарплата:",
      "🔶 Оклад + бонусы",
      "🔶 80 000 – 120 000 рублей на руки"
    ].join("\n")
  );

  assert.equal(details.role?.value, "Project Manager / Аккаунт-менеджер (Middle), удалённо");
  assert.equal(details.company?.value, "Kodi-IT");
  assert.equal(details.salary?.value, "80 000 – 120 000 рублей на руки");
  assert.equal(details.grade?.value, "Middle");
  assert.equal(details.workFormat?.value, "Remote");
  assert.match(details.geography?.value ?? "", /Челябинск/u);
  assert.equal(details.timeZone?.value, "Челябинск, Екатеринбург, Новосибирск, UTC+5 ±3 часа");
});

test("extractVacancyDetails reads short external source cards", () => {
  const details = extractVacancyDetails(
    "Менеджер активных продаж B2B (строительный инструмент)",
    [
      "Менеджер активных продаж B2B (строительный инструмент)",
      "от 200 000 ₽",
      "ФЕДАСТ ИМПОРТ",
      "https://finder.work/vacancies/31228756"
    ].join("\n")
  );

  assert.equal(details.role?.value, "Менеджер активных продаж B2B (строительный инструмент)");
  assert.equal(details.salary?.value, "от 200 000 ₽");
  assert.equal(details.company?.value, "ФЕДАСТ ИМПОРТ");
  assert.equal(details.engagement?.value, "B2B");
});

test("extractVacancyDetails reads salary ranges written with from-to words", () => {
  const details = extractVacancyDetails(
    "Руководитель маркетинга",
    [
      "Руководитель маркетинга",
      "от 100 000 до 200 000 ₽",
      "Плац",
      "https://finder.work/vacancies/31228755"
    ].join("\n")
  );

  assert.equal(details.salary?.value, "от 100 000 до 200 000 ₽");
  assert.equal(details.company?.value, "Плац");
});

test("extractVacancyDetails keeps agency company names intact in short cards", () => {
  const details = extractVacancyDetails(
    "Менеджер по продажам B2B (маркетинговые услуги)",
    [
      "Менеджер по продажам B2B (маркетинговые услуги)",
      "от 100 000 до 150 000 ₽",
      "Агентство интернет-маркетинга MedGrow",
      "https://finder.work/vacancies/31228967"
    ].join("\n")
  );

  assert.equal(details.company?.value, "Агентство интернет-маркетинга MedGrow");
});

test("extractVacancyDetails accepts agency suffix with role-like prefixes", () => {
  const details = extractVacancyDetails(
    "Контент-продюсер",
    [
      "Контент-продюсер",
      "от 100 000 ₽",
      "SMM-агентство 3:15"
    ].join("\n")
  );

  assert.equal(details.company?.value, "SMM-агентство 3:15");
});

test("extractVacancyDetails reads company and location from company sections", () => {
  const details = extractVacancyDetails(
    "Продуктовый дизайнер Rakuten Viber",
    [
      "Местоположение: London",
      "Формат работы: Гибрид",
      "О компании",
      "Rakuten Viber – популярное приложение для общения."
    ].join("\n")
  );

  assert.equal(details.company?.value, "Rakuten Viber");
  assert.equal(details.geography?.value, "London");
  assert.equal(details.workFormat?.value, "Гибрид");
});

test("extractVacancyDetails prefers real role over greeting title", () => {
  const details = extractVacancyDetails(
    "Всем привет!",
    [
      "Студия GraphON («Графон») открывает вакансию.",
      "Ищет в свою команду Houdini Lighting/Shading Artist.",
      "Формат: Офисный"
    ].join("\n")
  );

  assert.equal(details.role?.value, "Houdini Lighting/Shading Artist");
  assert.equal(details.company?.value, "GraphON");
  assert.equal(details.workFormat?.value, "Офисный");
});

test("extractVacancyDetails reads emoji-prefixed role, remote and Moscow time", () => {
  const details = extractVacancyDetails(
    "🔍",
    [
      "🧰Менеджер по продажам",
      "💰 до 200 000 руб.",
      "🌍 Удалённо",
      "🕐 Работа по МСК"
    ].join("\n")
  );

  assert.equal(details.role?.value, "Менеджер по продажам");
  assert.equal(details.salary?.value, "до 200 000 руб.");
  assert.equal(details.workFormat?.value, "Remote");
  assert.equal(details.timeZone?.value, "МСК");
});

test("extractVacancyDetails keeps slash-separated role variants as one role", () => {
  const details = extractVacancyDetails(
    "Технический специалист / специалист по чат-ботам",
    "Условия: 20 000 ₽, удаленный формат, график с 9:00 до 18:00 по Москве."
  );

  assert.equal(details.role?.value, "Технический специалист / специалист по чат-ботам");
  assert.equal(details.company, undefined);
  assert.equal(details.salary?.value, "20 000 ₽");
});

test("extractVacancyDetails keeps remote and hybrid combination informative", () => {
  const details = extractVacancyDetails(
    "Менеджер по продажам",
    "Возможность работать удалённо или в гибридном формате."
  );

  assert.equal(details.workFormat?.value, "Remote/Hybrid");
});

test("extractVacancyDetails prefers concise role line over later hiring sentence", () => {
  const details = extractVacancyDetails(
    "🔍",
    [
      "🧰Менеджер по продажам",
      "В связи с расширением мы ищем менеджера по продажам, который умеет выстраивать отношения с B2B клиентами."
    ].join("\n")
  );

  assert.equal(details.role?.value, "Менеджер по продажам");
});

test("extractVacancyDetails uses hiring phrase before later responsibility lines", () => {
  const details = extractVacancyDetails(
    "Всем привет!",
    [
      "Студия GraphON открывает вакансию.",
      "Ищет в свою команду Compositing Artist.",
      "Обязанности:",
      "– взаимодействие с художниками и другими членами команды"
    ].join("\n")
  );

  assert.equal(details.role?.value, "Compositing Artist");
});

test("extractVacancyDetails does not infer Meta disclaimer as company", () => {
  const details = extractVacancyDetails(
    "SMM Manager",
    "Опыт с Instagram. Instagram принадлежит компании Meta, признанной экстремистской и запрещенной."
  );

  assert.equal(details.company, undefined);
});

test("extractVacancyDetails does not infer action phrases as company", () => {
  const details = extractVacancyDetails(
    "Директор по маркетингу",
    "Вам предстоит разработать стратегию компании на короткую и долгосрочную перспективу."
  );

  assert.equal(details.company, undefined);
});

test("vacancy card analysis finds explicit warnings without treating crypto as a warning", () => {
  const analysis = analyzeVacancyCard(
    "#vacancy #remote",
    [
      "Роль: Frontend Developer",
      "Удалённо, только для кандидатов из Сербии, кроме РФ.",
      "Оплата в USDT."
    ].join("\n")
  );

  assert.equal(analysis.displayTitle, "Frontend Developer");
  assert.deepEqual(analysis.warnings, ["russia_not_allowed", "remote_geo_restricted"]);
  assert.ok(!analysis.warnings.includes("unpaid"));
});

test("vacancy card analysis rejects bad titles and does not infer random money as salary", () => {
  const analysis = analyzeVacancyCard(
    "[ссылка]",
    [
      "Senior Backend Engineer в Acme",
      "Компенсация за интернет до 150 ₽.",
      "Remote, B2B contract."
    ].join("\n")
  );

  assert.equal(analysis.displayTitle, "Senior Backend Engineer");
  assert.equal(analysis.details.company?.value, "Acme");
  assert.equal(analysis.details.salary, undefined);
  assert.equal(analysis.details.engagement?.value, "B2B");
});

test("vacancy card analysis keeps slash inside a role", () => {
  const analysis = analyzeVacancyCard("Frontend / Web Developer", "Remote. TypeScript.");

  assert.equal(analysis.displayTitle, "Frontend / Web Developer");
  assert.equal(analysis.details.company, undefined);
});

test("vacancy card analysis does not confuse role names and generic location text with warnings", () => {
  const projectManager = analyzeVacancyCard("Senior Project Manager", "Remote. English B2.");
  const remoteWithEngagement = analyzeVacancyCard(
    "Data Engineer",
    "Локация: Удалённо. Оформление по ИП."
  );

  assert.equal(projectManager.details.employment, undefined);
  assert.deepEqual(projectManager.warnings, []);
  assert.equal(remoteWithEngagement.details.engagement?.value, "ИП");
  assert.deepEqual(remoteWithEngagement.warnings, []);
});
