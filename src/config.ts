
import { DEFAULT_API_URL, DEFAULT_LLU_VERSION, DEFAULT_PRODUCT } from "./version-resolver";

const LIBRE_LINK_API_URL = process?.env?.LIBRE_LINK_API_URL ?? DEFAULT_API_URL;
const LIBRE_LINK_EMAIL = process?.env?.LIBRE_LINK_EMAIL;
const LIBRE_LINK_PASSWORD = process?.env?.LIBRE_LINK_PASSWORD;
const LIBRE_LINK_UP_VERSION = process?.env?.LIBRE_LINK_UP_VERSION ?? DEFAULT_LLU_VERSION;
const LIBRE_LINK_PATIENT_ID = process?.env?.LIBRE_LINK_PATIENT_ID;
const LIBRE_LINK_PRODUCT = process?.env?.LIBRE_LINK_PRODUCT ?? DEFAULT_PRODUCT;

/**
 * @description Configuration for the Libre Link Up API client.
 */
export const config = Object.freeze({
    apiUrl: LIBRE_LINK_API_URL,
    patientId: LIBRE_LINK_PATIENT_ID,
    credentials: {
        email: LIBRE_LINK_EMAIL,
        password: LIBRE_LINK_PASSWORD
    },
    lluVersion: LIBRE_LINK_UP_VERSION,
    product: LIBRE_LINK_PRODUCT,
});
