import Head from "next/head";
import Script from "next/script";
import dynamic from "next/dynamic";

const ExcelAssistant = dynamic(
  async () =>
    import("@/components/excel-addin/excel-assistant").then(
      (module) => module.ExcelAssistant,
    ),
  { ssr: false },
);

const ExcelProvider = dynamic(
  async () =>
    import("@/components/excel-addin/excel-context").then(
      (module) => module.ExcelProvider,
    ),
  { ssr: false },
);

export default function ExcelAddinPage() {
  return (
    <>
      <Head>
        <title>RowsnColumns Excel Assistant</title>
      </Head>
      <Script
        src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"
        strategy="afterInteractive"
      />
      <ExcelProvider>
        <ExcelAssistant />
      </ExcelProvider>
    </>
  );
}
