import path from "node:path";
import { readJsonFile, writeJsonFile } from "../utils/file-util.js";

/**
 * Account storage — one record per username in `server/data/users.json`.
 *
 * The file is the authoritative list of accounts that exist: a session is only
 * as valid as its record here, so the request gate and the game socket both
 * ask this store before trusting a username. Credentials live nowhere yet;
 * logging in is what creates a record, and the record's contents are the
 * account's own business.
 */

/** The only declaration of where accounts live. */
export const usersFilePath = path.resolve("server/data/users.json");

const isUsername = (username) => typeof username === "string" && username.trim() !== "";

const hasOwn = (accounts, username) => Object.prototype.hasOwnProperty.call(accounts, username);

/**
 * @param {{ filePath?: string }} [options]
 */
export function createAccountStore({ filePath = usersFilePath } = {}) {
  const readAccounts = () => readJsonFile(filePath);

  return {
    filePath,

    /**
     * Whether `username` currently has an account. A missing file reads as no
     * accounts at all, so an empty deployment accepts nobody.
     */
    async hasAccount(username) {
      if (!isUsername(username)) return false;
      const accounts = await readAccounts();
      return hasOwn(accounts, username);
    },

    /**
     * Create the record unless it already exists. Returns whether this call
     * created it, so the caller provisions exactly once per account and can
     * roll back a failed provisioning.
     */
    async createAccountIfMissing(username) {
      if (!isUsername(username)) throw new Error("A username is required to create an account.");
      const accounts = await readAccounts();
      if (hasOwn(accounts, username)) return false;
      accounts[username] = {};
      await writeJsonFile(filePath, accounts);
      return true;
    },

    /**
     * Remove the record. Returns whether one was there to remove. Any session
     * still holding that name stops being authenticated.
     */
    async removeAccount(username) {
      if (!isUsername(username)) throw new Error("A username is required to remove an account.");
      const accounts = await readAccounts();
      if (!hasOwn(accounts, username)) return false;
      delete accounts[username];
      await writeJsonFile(filePath, accounts);
      return true;
    },
  };
}
