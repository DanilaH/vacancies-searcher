import test from "node:test";
import assert from "node:assert/strict";

import {
  assertSafeCompanyCareerUrl,
  detectCompanyCareerUrl,
  extractSupportedCompanyCareerUrl,
  normalizeCompanyCareerUrl
} from "../src/services/companyCareerUrls";

test("detectCompanyCareerUrl detects supported adapters", () => {
  assert.equal(detectCompanyCareerUrl("https://www.aviasales.ru/about/vacancies")?.adapter, "aviasales_html");
  assert.equal(detectCompanyCareerUrl("https://boards.greenhouse.io/acme")?.adapter, "greenhouse_job_board");
  assert.equal(detectCompanyCareerUrl("https://jobs.lever.co/acme")?.adapter, "lever_postings");
  assert.equal(detectCompanyCareerUrl("https://jobs.ashbyhq.com/acme")?.adapter, "ashby_posting");
  assert.equal(detectCompanyCareerUrl("https://jobs.smartrecruiters.com/acme")?.adapter, "smartrecruiters_postings");
});

test("assertSafeCompanyCareerUrl rejects localhost and private hosts", () => {
  assert.throws(() => assertSafeCompanyCareerUrl("http://example.com/careers"), /HTTPS/);
  assert.throws(() => assertSafeCompanyCareerUrl("https://localhost/careers"), /public hostname/);
  assert.throws(() => assertSafeCompanyCareerUrl("https://127.0.0.1/careers"), /public hostname/);
  assert.throws(() => assertSafeCompanyCareerUrl("https://192.168.1.10/careers"), /public hostname/);
});

test("normalizeCompanyCareerUrl strips tracking parameters and hash", () => {
  assert.equal(
    normalizeCompanyCareerUrl("https://www.aviasales.ru/about/vacancies/4263584?utm_source=tg&foo=bar#section"),
    "https://www.aviasales.ru/about/vacancies/4263584?foo=bar"
  );
});

test("extractSupportedCompanyCareerUrl extracts supported company links from Telegram text", () => {
  assert.equal(
    extractSupportedCompanyCareerUrl("New role https://www.aviasales.ru/about/vacancies/4263584?utm_source=tg"),
    "https://www.aviasales.ru/about/vacancies/4263584"
  );
  assert.equal(extractSupportedCompanyCareerUrl("Generic https://example.com/jobs/frontend"), null);
});
