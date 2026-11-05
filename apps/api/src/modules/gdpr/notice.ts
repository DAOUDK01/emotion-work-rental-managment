import { getSetting } from '../../services/settings.js';

/**
 * Built-in GDPR privacy notice (EN + FI) for the shop. Admins can override the
 * texts via the setting `gdpr.privacyNotice` ({ textEn, textFi }); any field that
 * is missing or blank there falls back to these defaults. Company contact details
 * are interpolated from the `company` setting so the default text never goes
 * stale when the company record changes.
 */

export interface PrivacyNotice {
  textEn: string;
  textFi: string;
}

interface CompanyInfo {
  name?: unknown;
  businessId?: unknown;
  address?: unknown;
  postalCode?: unknown;
  city?: unknown;
  country?: unknown;
  phone?: unknown;
  email?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function buildTextEn(name: string, businessId: string, address: string, contact: string): string {
  return `PRIVACY NOTICE — ${name}${businessId ? ` (Business ID ${businessId})` : ''}

${name} (${address}) rents out, repairs and sells electric scooters, e-bikes and spare parts.
To do that we keep a small customer register. This notice explains in plain language what we
store about you, why, for how long, and what you can ask us to do with it (EU General Data
Protection Regulation, Articles 13–14).

1. WHAT WE STORE
- Contact details you give us: name, phone number, email address, postal address, and for
  business customers the company name and Business ID (Y-tunnus).
- Your rental history: which vehicle you rented, the rental period, deposits and the agreed price.
- Your payment and invoicing history: amounts, dates, payment methods, invoices and receipts.
- Receipts and documents uploaded to your file, such as signed rental agreements.
- Repair and service notes about work you ordered from us.

2. WHY WE STORE IT
- To set up and manage your rental, repair or purchase (performance of a contract).
- To invoice you and to keep our accounts as the law requires (legal obligation).
- To contact you about your rental — returns, faults, deposits or overdue payments.
We do not sell your data, we do not use it for automated decision-making or profiling, and we
share it only with our accountant and with authorities when the law requires it.

3. HOW LONG WE KEEP IT
Bookkeeping material — invoices, receipts, payment records and other accounting records — must
be kept for six (6) years from the end of the financial year under the Finnish Bookkeeping Act
(kirjanpitolaki 1336/1997). We cannot erase those records earlier, even at your request.
Contact details that are no longer needed for any open rental, warranty case or unpaid invoice
are erased or anonymised on request.

4. YOUR RIGHTS
You have the right to:
- ask for a copy of all the data we hold about you (right of access and data portability);
- ask us to correct wrong or outdated information (rectification);
- ask us to erase your personal data (erasure, the "right to be forgotten") — we anonymise your
  customer record; financial records stay, without your contact details, for the legal retention
  period above;
- complain to the supervisory authority, the Office of the Data Protection Ombudsman
  (tietosuoja.fi), if you believe we handle your data unlawfully.

5. CONTACT
For any request about your data, contact ${contact}. We reply within one month.`;
}

function buildTextFi(name: string, businessId: string, address: string, contact: string): string {
  return `TIETOSUOJASELOSTE — ${name}${businessId ? ` (Y-tunnus ${businessId})` : ''}

${name} (${address}) vuokraa, korjaa ja myy sähköpotkulautoja, sähköpyöriä ja varaosia. Sitä
varten pidämme pientä asiakasrekisteriä. Tässä selosteessa kerromme selkeällä kielellä, mitä
tietoja sinusta tallennamme, miksi, kuinka kauan ja mitä voit pyytää meitä tekemään niille
(EU:n yleinen tietosuoja-asetus, 13–14 artikla).

1. MITÄ TALLENNAMME
- Antamasi yhteystiedot: nimi, puhelinnumero, sähköpostiosoite ja postiosoite sekä
  yritysasiakkailta yrityksen nimi ja Y-tunnus.
- Vuokraushistoriasi: mikä ajoneuvo, vuokra-aika, vakuudet ja sovittu hinta.
- Maksu- ja laskutushistoriasi: summat, päivämäärät, maksutavat, laskut ja kuitit.
- Asiakastietoihisi tallennetut kuitit ja asiakirjat, kuten allekirjoitetut vuokrasopimukset.
- Meiltä tilaamiisi töihin liittyvät korjaus- ja huoltomerkinnät.

2. MIKSI TALLENNAMME
- Vuokrauksen, korjauksen tai kaupan tekemiseksi ja hoitamiseksi (sopimuksen täyttäminen).
- Laskutusta ja lakisääteistä kirjanpitoa varten (lakisääteinen velvoite).
- Jotta voimme olla sinuun yhteydessä vuokraukseesi liittyen — palautukset, viat, vakuudet ja
  erääntyneet maksut.
Emme myy tietojasi emmekä käytä niitä automaattiseen päätöksentekoon tai profilointiin.
Luovutamme tietoja vain kirjanpitäjällemme ja viranomaisille, kun laki sitä vaatii.

3. SÄILYTYSAIKA
Kirjanpitoaineisto — laskut, kuitit, maksutapahtumat ja muu kirjanpitoaineisto — on
kirjanpitolain (1336/1997) mukaan säilytettävä kuusi (6) vuotta tilikauden päättymisestä.
Emme voi poistaa näitä tietoja aikaisemmin edes pyynnöstäsi. Yhteystiedot, joita ei enää
tarvita avoimeen vuokraukseen, takuuasiaan tai maksamattomaan laskuun, poistetaan tai
anonymisoidaan pyynnöstä.

4. OIKEUTESI
Sinulla on oikeus:
- pyytää kopio kaikista sinua koskevista tiedoistamme (tarkastusoikeus ja siirto-oikeus);
- pyytää virheellisen tai vanhentuneen tiedon korjaamista (oikaisu);
- pyytää henkilötietojesi poistamista ("oikeus tulla unohdetuksi") — anonymisoimme
  asiakastietosi; taloustiedot säilyvät ilman yhteystietojasi yllä mainitun lakisääteisen
  säilytysajan;
- tehdä valitus valvontaviranomaiselle eli tietosuojavaltuutetun toimistolle (tietosuoja.fi),
  jos katsot, että käsittelemme tietojasi lainvastaisesti.

5. YHTEYDENOTOT
Tietojasi koskevat pyynnöt: ${contact}. Vastaamme kuukauden kuluessa.`;
}

/** Default notice texts with live company details from settings. */
export async function defaultPrivacyNotice(): Promise<PrivacyNotice> {
  const company = await getSetting<CompanyInfo>('company', {});
  const name = str(company.name) || 'E Motion Works Oy';
  const businessId = str(company.businessId);
  const postal = [str(company.postalCode), str(company.city)].filter(Boolean).join(' ');
  const address = [str(company.address), postal].filter(Boolean).join(', ') || 'Turku, Finland';
  const contact = [name, address, str(company.email), str(company.phone)].filter(Boolean).join(', ');
  return {
    textEn: buildTextEn(name, businessId, address, contact),
    textFi: buildTextFi(name, businessId, address, contact),
  };
}

/** Stored setting `gdpr.privacyNotice` merged per-field over the built-in default. */
export async function resolvePrivacyNotice(): Promise<PrivacyNotice> {
  const defaults = await defaultPrivacyNotice();
  const stored = await getSetting<unknown>('gdpr.privacyNotice', null);
  const value: Record<string, unknown> =
    stored !== null && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const textEn = str(value.textEn) || defaults.textEn;
  const textFi = str(value.textFi) || defaults.textFi;
  return { textEn, textFi };
}
