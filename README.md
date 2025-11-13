Questa cartella contiene un esempio di applicazione micro‑blog costruita
utilizzando il Pear Runtime. L’applicazione è simile a un feed di
micro‑messaggi alla Twitter: ogni peer può pubblicare brevi post e tutte le
pubblicazioni vengono condivise in rete tramite il protocollo P2P. La logica
si basa sulla combinazione di alcuni componenti chiave della documentazione
Pear:

Corestore – un “fabbrica” di Hypercore consigliata da Pear per
gestire collezioni di log append‑only. La guida su come gestire molti
Hypercore sottolinea che un’unica Corestore per applicazione semplifica
replicazione e gestione
docs.pears.com
.

Autobase – una struttura multi‑writer che linearizza i messaggi
provenienti da più writer per produrre una vista coerente nel tempo. La
documentazione descrive Autobase come un modo per combinare i log dei vari
autori mantenendo eventual consistency
docs.pears.com
. L’app
definisce una funzione open che crea la vista e una funzione apply che
applica i nuovi nodi alla vista
docs.pears.com
.

Hyperswarm – la libreria di networking P2P che permette ai peer di
scoprire gli altri tramite una chiave di scoperta. La documentazione
spiega come unirsi a una rete usando la base.discoveryKey di Autobase e
replicare l’archivio Corestore su ogni connessione
docs.pears.com
.

Dipendenze

Per eseguire l’app sono necessari i seguenti pacchetti (oltre al runtime
Bare/Pear):

npm install autobase corestore hyperswarm b4a bare-readline bare-tty


Questi moduli vengono usati anche negli esempi ufficiali di Pear per le
applicazioni di chat
docs.pears.com
. Bare è un runtime
minimalista simile a Node.js; su desktop/terminal viene usato bare-readline
per leggere dal terminale. Nota: su dispositivi mobili è consigliato
creare una Bare mobile application con interfaccia grafica e gestire
l’input tramite componenti UI anziché bare-readline, secondo le linee
guida di Pear per le app mobili.

Avvio di un nuovo feed

Portarsi nella cartella pear-blog-app ed eseguire pear run --dev ..

L’app crea una nuova base e stampa una chiave esadecimale. Questa è la
chiave del writer (la chiave pubblica del tuo feed) generata
automaticamente; condividila con gli amici per permettere loro di unirsi al tuo
feed. Nella GUI la chiave compare in alto sotto “Feed key”.

Inizia a digitare messaggi: saranno salvati come JSON con autore,
testo e timestamp. Ogni volta che un nuovo post viene applicato alla
vista, l’app lo stampa in console.

Interfaccia grafica

Questa cartella contiene anche un semplice front‑end (index.html e
app.js) che fornisce una GUI minimalista. Quando esegui pear run --dev .
in una finestra Pear Desktop, si aprirà automaticamente l’interfaccia
grafica. Puoi scegliere “Crea nuovo feed” per generare una nuova base o
inserire una chiave di un feed esistente per unirti. L’interfaccia
mostra l’elenco dei post, la chiave del feed e il numero di peer
connessi; sotto è presente un campo testo per pubblicare nuovi post.

Unirsi a un feed esistente

Se hai ricevuto una chiave da qualcun altro:

pear run --dev . <CHIAVE_FEED>


L’app proverà a collegarsi ai peer che annunciano quella chiave di feed e
replicherà il log. Ogni volta che un post viene pubblicato dal creatore o
da un altro writer, lo vedrai comparire nella tua console. Puoi a tua volta
pubblicare nuovi messaggi: saranno linearizzati e condivisi con tutti i
partecipanti grazie ad Autobase.

Adattamento mobile

La documentazione di Pear evidenzia che il runtime Bare viene usato
ampiamente per la compatibilità e la modularità. Tuttavia, per rendere
un’applicazione realmente usabile su smartphone, è consigliabile creare una
Bare mobile application (guida Making a Bare Mobile Application) che
utilizzi componenti grafici al posto delle librerie di terminale bare‑tty
e bare-readline. In particolare bisognerà:

Generare un progetto mobile con pear init --type mobile e definire un
layout HTML/CSS/JS per l’interfaccia del feed.

Sostituire l’interfaccia di input/visualizzazione di questo esempio con
componenti HTML (ad esempio un formulario per scrivere un post e un div
scorrevole per mostrare il feed). La logica di rete, basata su
Corestore/Autobase/Hyperswarm, resta invariata.

Assicurarsi che i pacchetti usati siano compatibili con la piattaforma
mobile (Pear/Bare include un bundler che prepara i moduli per Android/iOS).

Con questi adattamenti il micro‑blog potrà funzionare sia su desktop che
su smartphone senza necessità di server centrali.