import Link from "next/link";

// Privacy notice (GDPR Art. 13/14). Keep it in sync with what the code does: sources in
// src/worker/sources, retention in src/worker/jobs/purge.ts, CLAUDE.md rule 1.
// Controller name and contact come from PRIVACY_CONTROLLER_NAME / PRIVACY_CONTACT_EMAIL.

export const metadata = {
  title: "Privacy · Bologna Safety Map",
  description: "Informativa privacy / Privacy notice",
};

const LAST_UPDATED = { it: "21 ottobre 2026", en: "21 October 2026" };
const REPO = "https://github.com/JimmyGla/bologna-safety-map";

function Controller({ lang }: { lang: "it" | "en" }) {
  const name = process.env.PRIVACY_CONTROLLER_NAME?.trim();
  const email = process.env.PRIVACY_CONTACT_EMAIL?.trim();
  // Without an email, requests go through GitHub issues, which are public: say so.
  const contact = email ? (
    <a href={`mailto:${email}`} className="underline">
      {email}
    </a>
  ) : (
    <>
      <a href={`${REPO}/issues/new`} className="underline">
        {lang === "it" ? "apri una segnalazione (issue) su GitHub" : "open an issue on GitHub"}
      </a>{" "}
      {lang === "it"
        ? "(le segnalazioni sono pubbliche: non scrivere dati personali, basta indicare cosa chiedi)"
        : "(issues are public: don't include personal details, just say what you are asking for)"}
    </>
  );
  return lang === "it" ? (
    <p>
      Titolare del trattamento: <strong>{name || "il gestore di questo sito"}</strong>. Contatto: {contact}. Questo sito è un
      progetto indipendente: non è collegato al Comune di Bologna, alla Questura o ad altre autorità.
    </p>
  ) : (
    <p>
      Data controller: <strong>{name || "the operator of this site"}</strong>. Contact: {contact}. This site is an independent
      project, not affiliated with the Comune di Bologna, the Questura or any authority.
    </p>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-base font-semibold text-gray-900">{children}</h3>;
}

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-white">
    <main className="mx-auto max-w-3xl px-4 py-8 text-sm leading-relaxed text-gray-800 sm:py-12">
      <p className="mb-6">
        <Link href="/" className="text-gray-600 underline">
          ← Mappa / Map
        </Link>
        <span className="mx-2 text-gray-400">·</span>
        <a href="#en" className="text-gray-600 underline">
          English below
        </a>
      </p>

      {/* ------------------------------------------------------------- Italiano */}
      <section lang="it" className="space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900">Informativa privacy</h1>
        <p className="text-gray-500">Ultimo aggiornamento: {LAST_UPDATED.it}</p>
        <p>
          Bologna Safety Map mostra quali <strong>zone</strong> di Bologna sono interessate da manifestazioni in corso. Mappa aree,
          mai persone: sulla mappa e nei dati pubblici non compaiono nomi, nomi utente, profili o testi di post.
        </p>
        <Controller lang="it" />

        <H>1. Quali dati trattiamo</H>
        <p>
          <strong>Contenuti pubblici delle fonti.</strong> Raccogliamo automaticamente contenuti già pubblici che parlano di
          manifestazioni: articoli dei giornali locali (feed RSS), avvisi TPER, post pubblici su Reddit (r/bologna), Mastodon
          (hashtag pubblici) e, se attivati, Bluesky e canali Telegram pubblici. Conserviamo solo il testo del contenuto, l’ora di
          pubblicazione, la fonte e, per i social, due indicatori generici sull’account: numero di follower ed età dell’account.
        </p>
        <p>
          <strong>Non conserviamo</strong> nomi, nomi utente, handle, foto o link ai profili. I nomi utente presenti nel testo
          (es. “u/…”, “@…”) vengono rimossi prima del salvataggio. Per Bluesky e Mastodon non salviamo il link al post e
          l’identificativo viene salvato solo in forma cifrata (hash). Poiché i contenuti riguardano manifestazioni, possono
          indirettamente rivelare opinioni politiche di chi li ha pubblicati; trattiamo solo contenuti resi manifestamente pubblici
          dagli autori stessi e solo per ricavarne informazioni su aree, non su persone.
        </p>
        <p>
          <strong>Dati derivati.</strong> Da questi contenuti ricaviamo “eventi” anonimi (tipo di evento, gravità, nomi di luoghi,
          celle della mappa, categoria della fonte). Non contengono dati personali.
        </p>
        <p>
          <strong>Visitatori del sito.</strong> La mappa pubblica non usa cookie, né strumenti di analisi o profilazione. Il tuo
          indirizzo IP è usato solo in memoria, per al massimo un minuto, per limitare le richieste eccessive, e non viene salvato.
          Il fornitore di hosting (Vercel) può registrare dati tecnici delle richieste nei propri log. Le immagini della mappa
          sono caricate dal tuo browser dal servizio gratuito{" "}
          <a href="https://openfreemap.org" className="underline">
            OpenFreeMap
          </a>{" "}
          (dati OpenStreetMap), che riceve quindi il tuo indirizzo IP come per qualsiasi richiesta web. L’area di amministrazione usa un unico cookie tecnico di sessione, solo per i gestori.
        </p>

        <H>2. Perché e su quale base giuridica</H>
        <p>
          Lo scopo è informare il pubblico su quali zone della città sono interessate da manifestazioni, per la sicurezza e gli
          spostamenti delle persone. La base giuridica è il legittimo interesse (art. 6, par. 1, lett. f GDPR), bilanciato con
          misure di minimizzazione: solo contenuti pubblici, nessun nome utente conservato, cancellazione automatica dopo 24 ore.
          Per gli eventuali dati che rivelano opinioni politiche ci basiamo sul fatto che sono stati resi manifestamente pubblici
          dagli interessati (art. 9, par. 2, lett. e GDPR). Non prendiamo decisioni automatizzate che producano effetti giuridici
          sulle persone.
        </p>

        <H>3. Per quanto tempo</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>Testi dei contenuti raccolti: cancellati automaticamente dopo <strong>24 ore</strong>.</li>
          <li>Eventi anonimi: 7 giorni.</li>
          <li>Cache dei nomi di luogo geocodificati (solo nomi di vie e piazze): fino a 30 giorni.</li>
          <li>Contatori tecnici di utilizzo dei servizi: 30 giorni.</li>
          <li>Log tecnici: per il tempo previsto dai fornitori (Vercel, GitHub); non contengono testi dei post.</li>
        </ul>

        <H>4. Fornitori e destinatari</H>
        <p>
          I dati non vengono venduti né ceduti. Per far funzionare il sito usiamo questi fornitori, che li trattano per nostro
          conto: Vercel (hosting del sito), Neon (database, server a Francoforte), GitHub (esecuzione periodica della raccolta).
          Alcuni hanno sede negli Stati Uniti; i trasferimenti avvengono con le garanzie previste dal GDPR (Data Privacy Framework
          o clausole contrattuali standard). Per individuare i luoghi sulla mappa inviamo a OpenStreetMap Nominatim solo nomi di
          luoghi, mai il testo dei post. Se viene attivata la classificazione automatica con un servizio di intelligenza
          artificiale (Google Gemini), il testo dei contenuti, senza nomi utente, viene inviato a Google per essere classificato.
        </p>

        <H>5. I tuoi diritti</H>
        <p>
          Puoi chiedere accesso, rettifica, cancellazione, limitazione e opporti al trattamento (artt. 15–21 GDPR) scrivendo al
          contatto indicato sopra. Poiché non conserviamo nomi utente, potremmo non essere in grado di ritrovare un tuo contenuto
          senza il link o il testo (art. 11 GDPR); in ogni caso i testi vengono cancellati entro 24 ore. Hai anche il diritto di
          presentare reclamo al{" "}
          <a href="https://www.garanteprivacy.it" className="underline">
            Garante per la protezione dei dati personali
          </a>
          .
        </p>
      </section>

      <hr className="my-10 border-gray-200" />

      {/* -------------------------------------------------------------- English */}
      <section id="en" lang="en" className="space-y-3">
        <h2 className="text-2xl font-semibold text-gray-900">Privacy notice</h2>
        <p className="text-gray-500">Last updated: {LAST_UPDATED.en}</p>
        <p>
          Bologna Safety Map shows which <strong>areas</strong> of Bologna are affected by ongoing protests. It maps areas, never
          people: no names, usernames, profiles or post texts appear on the map or in the public data.
        </p>
        <Controller lang="en" />

        <H>1. What we process</H>
        <p>
          <strong>Public content from sources.</strong> We automatically collect already-public content about protests: local
          news articles (RSS feeds), TPER transit alerts, public posts on Reddit (r/bologna), Mastodon (public hashtags) and, if
          enabled, Bluesky and public Telegram channels. We keep only the text, the publication time, the source and, for social
          posts, two coarse account signals: follower count and account age.
        </p>
        <p>
          <strong>We do not keep</strong> names, usernames, handles, photos or profile links. Usernames inside the text (e.g.
          “u/…”, “@…”) are removed before saving. For Bluesky and Mastodon we store no link to the post, and the post identifier
          only as a hash. Because the content is about protests, it may indirectly reveal the author’s political opinions; we only
          process content its authors have manifestly made public, and only to derive information about areas, not people.
        </p>
        <p>
          <strong>Derived data.</strong> From this content we derive anonymous “events” (event type, severity, place names, map
          cells, source category). They contain no personal data.
        </p>
        <p>
          <strong>Visitors.</strong> The public map uses no cookies, analytics or profiling. Your IP address is used in memory
          only, for at most a minute, to limit excessive requests, and is not stored. Our hosting provider (Vercel) may record
          technical request data in its logs. Map images are loaded by your browser from the free{" "}
          <a href="https://openfreemap.org" className="underline">
            OpenFreeMap
          </a>{" "}
          service (OpenStreetMap data), which therefore receives your IP address, as with any web request. The admin area uses a single technical session cookie, for maintainers only.
        </p>

        <H>2. Why, and on what legal basis</H>
        <p>
          The purpose is to inform the public about which parts of the city are affected by protests, for people’s safety and
          travel. The legal basis is legitimate interest (Art. 6(1)(f) GDPR), balanced by data minimisation: public content only,
          no usernames kept, automatic deletion after 24 hours. For any data revealing political opinions we rely on it having
          been manifestly made public by the people concerned (Art. 9(2)(e) GDPR). We make no automated decisions with legal
          effects on anyone.
        </p>

        <H>3. How long we keep it</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>Texts of collected content: deleted automatically after <strong>24 hours</strong>.</li>
          <li>Anonymous events: 7 days.</li>
          <li>Cache of geocoded place names (street and square names only): up to 30 days.</li>
          <li>Technical service-usage counters: 30 days.</li>
          <li>Technical logs: as long as the providers keep them (Vercel, GitHub); they contain no post texts.</li>
        </ul>

        <H>4. Providers and recipients</H>
        <p>
          Data is never sold or shared. To run the site we use these providers, which process data on our behalf: Vercel
          (hosting), Neon (database, servers in Frankfurt), GitHub (scheduled collection runs). Some are based in the United
          States; transfers rely on the safeguards provided by the GDPR (Data Privacy Framework or standard contractual clauses).
          To place locations on the map we send OpenStreetMap Nominatim place names only, never post texts. If automatic
          classification with an AI service (Google Gemini) is enabled, content text, without usernames, is sent to Google to be
          classified.
        </p>

        <H>5. Your rights</H>
        <p>
          You can request access, rectification, erasure or restriction, and object to the processing (Arts. 15–21 GDPR) by
          writing to the contact above. Because we keep no usernames, we may be unable to find your content without its link or
          text (Art. 11 GDPR); in any case texts are deleted within 24 hours. You also have the right to lodge a complaint with
          the Italian data protection authority,{" "}
          <a href="https://www.garanteprivacy.it" className="underline">
            Garante per la protezione dei dati personali
          </a>
          .
        </p>
      </section>
    </main>
    </div>
  );
}
