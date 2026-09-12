import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAccountStore } from "./accountStore.js";

function makeStore(accounts) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shinsu-accounts-"));
  const filePath = path.join(directory, "users.json");
  if (accounts) fs.writeFileSync(filePath, JSON.stringify(accounts, null, 2));
  return createAccountStore({ filePath });
}

const recorded = (store) => JSON.parse(fs.readFileSync(store.filePath, "utf8"));

describe("account store", () => {
  test("an absent file reads as no accounts and is created on first read", async () => {
    const store = makeStore();

    expect(await store.hasAccount("Alice")).toBe(false);
    expect(recorded(store)).toEqual({});
  });

  test("a blank or missing username never has an account", async () => {
    const store = makeStore({ Alice: {} });

    expect(await store.hasAccount("")).toBe(false);
    expect(await store.hasAccount("   ")).toBe(false);
    expect(await store.hasAccount(undefined)).toBe(false);
    expect(await store.hasAccount("Alice")).toBe(true);
  });

  test("creates a record once and preserves the accounts already there", async () => {
    const store = makeStore({ Bob: {} });

    expect(await store.createAccountIfMissing("Alice")).toBe(true);
    expect(await store.createAccountIfMissing("Alice")).toBe(false);
    expect(recorded(store)).toEqual({ Bob: {}, Alice: {} });
  });

  test("removes a record and reports whether one was there", async () => {
    const store = makeStore({ Alice: {}, Bob: {} });

    expect(await store.removeAccount("Alice")).toBe(true);
    expect(await store.removeAccount("Alice")).toBe(false);
    expect(await store.hasAccount("Alice")).toBe(false);
    expect(await store.hasAccount("Bob")).toBe(true);
    expect(recorded(store)).toEqual({ Bob: {} });
  });

  test("refuses a blank username when creating or removing", async () => {
    const store = makeStore({});

    await expect(store.createAccountIfMissing("   ")).rejects.toThrow(/username is required/);
    await expect(store.removeAccount("")).rejects.toThrow(/username is required/);
    expect(recorded(store)).toEqual({});
  });
});
