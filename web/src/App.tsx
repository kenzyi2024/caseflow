import { useEffect, useState } from "react";
import { Alert, AlertHeading, AlertText, GridContainer, Header, Title } from "@trussworks/react-uswds";

type Health = { status: string; policies: { version: string; effectiveFrom: string; effectiveTo: string }[] };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <Header basic>
        <div className="usa-nav-container">
          <div className="usa-navbar">
            <Title>CaseFlow · SNAP casework (demo)</Title>
          </div>
        </div>
      </Header>
      <main id="main-content">
        <GridContainer className="padding-y-4">
          <Alert type="info">
            <AlertHeading level="h2">Independent demo</AlertHeading>
            <AlertText>
              Modeled on Arlington County DHS and Virginia Department of Social Services SNAP workflows. Not affiliated with
              Arlington County, VDSS, or the Virginia Employment Commission. Synthetic data only.
            </AlertText>
          </Alert>
          {error && (
            <Alert type="error">
              <AlertHeading level="h2">API unavailable</AlertHeading>
              <AlertText>{error}</AlertText>
            </Alert>
          )}
          {health && (
            <p>
              API: <strong>{health.status}</strong> · Policy versions loaded:{" "}
              {health.policies.map((p) => `${p.version} (${p.effectiveFrom} → ${p.effectiveTo})`).join(", ")}
            </p>
          )}
        </GridContainer>
      </main>
    </>
  );
}
