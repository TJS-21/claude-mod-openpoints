# openpoints – Offene Punkte

Eine Claude-Code-Mod: offene Aufgaben je Projekt, die sich selbst füllen.

## Anzeige
- **Band über dem Eingabefeld**: schmaler grauer Streifen „Offene Punkte: Projekt 4“, ganz rechts der Link **Öffnen** bzw. **Einklappen**, je nachdem, ob das Panel offen ist (im Terminal ein Knopf). Andere Bänder (z. B. die Nutzungsleiste) bleiben darunter sichtbar.
- **Panel** (öffnet sich beim Start von selbst, sonst `/offene-punkte`): oben die Zahl offener Punkte, die Uhrzeit des letzten Abgleichs und **Aktualisieren**; je Projekt ein schmaler grauer Streifen mit **Zuklappen**; je Punkt der Text und darunter kleine Links **Erledigt · Veraltet · Zum Chat · Frage dazu**. Veraltete und erledigte Punkte stehen ganz unten, zugeklappt. Im Terminal sind die Links Knöpfe.
- Klicks in der Leiste ändern nur die Liste und schreiben **nichts in den laufenden Chat**; oben zeigt eine Zeile, was passiert ist („Abgehakt: …“).
  - **Erledigt** hakt ab (mit **Zurück**, 14 Tage sichtbar).
  - **Zum Chat** öffnet den Ursprungs-Chat in der Claude-App auf dem Mac; auf dem Handy gibt es nur den Web-Link.
  - **Frage dazu** gibt es nur in der Claude-Code-Sitzung, in der der Punkt entstand. Der Knopf legt die Frage ins Eingabefeld; abgeschickt wird sie von dir.
  - **Veraltet** markiert den Punkt (Bereich „Als veraltet markiert“, mit **Zurück**). Geklärt wird später im passenden Chat; Claude trägt das Ergebnis mit `punkte_klaeren` ein.
- Offene Punkte, die 30 Tage niemand angefasst hat, bekommen „(alt?)“.

## Punkte entstehen im Chat
- Nennt eine Antwort Aufgaben für dich oder wird etwas vertagt, fragt Claude am Ende kurz, ob es die Punkte auf die Liste setzen soll (mit Wortlaut und Projekt). Eingetragen wird erst nach deinem OK (`punkte_hinzufuegen`); so entscheidest du mit dem vollen Zusammenhang des Chats.
- Erledigtes hakt Claude im Gespräch ab (`punkte_erledigt`), veraltete Punkte klärt es mit dir (`punkte_klaeren`).
- Was in kein Projekt passt, kommt nach „Allgemein“.
- Ohne Oberfläche (`claude -p`, etwa aus n8n) gilt die Regel nicht. Aufrufe über die Claude-API laufen gar nicht durch Claude Code.

## Daten
- Die Listen liegen im eigenen privaten Repo [TJS-21/claude-openpoints-daten](https://github.com/TJS-21/claude-openpoints-daten), je Projekt eine Datei `punkte/<projekt>.json`.
- Die Mod hält eine Kopie davon in `~/.claude/openpoints-daten` und lädt jede Änderung direkt hoch, immer nur die geänderte Listendatei.
- Abhaken ändert nur das Daten-Repo, nicht die Mod. Eine neue Mod-Version gibt es nur, wenn `version` in `.claude-plugin/plugin.json` erhöht wird.

## Installation

Am Prompt einer Terminal-Sitzung:

```
/plugin install openpoints --marketplace TJS-21/claude-mod-openpoints
```

Aus einer Shell:

```
claude plugin install openpoints --marketplace TJS-21/claude-mod-openpoints
```

In der Desktop-App: Plus neben dem Eingabefeld, dann Plugins, „Add marketplace“ mit `TJS-21/claude-mod-openpoints`, danach „Add plugin“.

Der Code der Mod (dieses Repo) ist öffentlich, die Listen liegen in einem eigenen **privaten** Daten-Repo. Damit die Mod die Listen abgleichen kann, muss Git auf dem Rechner bei github.com angemeldet sein (SSH-Schlüssel oder `gh auth login` und danach `gh auth setup-git`).

## Für andere Personen: eigene Listen

Jede Person nutzt ihr eigenes privates Daten-Repo; den Code teilt man sich.

1. Auf GitHub ein **privates** Repo anlegen, z. B. `claude-openpoints-daten`, und dabei **„Add a README file“** ankreuzen (ein ganz leeres Repo kann die Mod nicht abgleichen).
2. Git auf dem Mac bei GitHub anmelden: `gh auth login`, danach `gh auth setup-git`.
3. Marketplace hinzufügen und installieren: `claude plugin marketplace add TJS-21/claude-mod-openpoints`, dann `claude plugin install openpoints@tjs-21-mods`.
4. Beim Installieren fragt Claude Code drei Einstellungen ab (später unter `/config` änderbar):
   - **Daten-Repo**: die Adresse aus Schritt 1, z. B. `https://github.com/<name>/claude-openpoints-daten`
   - **Name**: mit dem Vornamen spricht Claude dich an; der ganze Name steht als Autor der Änderungen
   - **E-Mail für Git**: z. B. die anonyme GitHub-Adresse `…@users.noreply.github.com`

   Das Daten-Repo muss eingetragen werden; bleibt es leer, versucht die Mod, das Repo des Autors zu lesen (das scheitert ohne Zugriff). Bleiben Name oder E-Mail leer, gilt die Git-Identität des eigenen Rechners.
5. Die Mod legt die lokale Kopie in einem eigenen Ordner an (`~/.claude/openpoints-daten-<name>-<repo>`).

## Updates

Die Desktop-App startet Claude Code mit `DISABLE_AUTOUPDATER=1`, damit sind automatische Plugin-Updates aus. Neue Versionen deshalb von Hand holen: `version` erhöhen, hochladen, dann

```
claude plugin update openpoints@tjs-21-mods
```

Die neue Version gilt ab der nächsten Sitzung.
