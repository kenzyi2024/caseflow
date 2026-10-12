import { Link, NavLink, Route, Routes } from "react-router-dom";
import { Select } from "@trussworks/react-uswds";
import { BPS_USERS, setCurrentUser, useCurrentUser } from "./lib/user";
import { QueuePage } from "./pages/QueuePage";
import { CasePage } from "./pages/CasePage";
import { PoliciesPage } from "./pages/PoliciesPage";

export function App() {
  const user = useCurrentUser();
  return (
    <>
      <a className="usa-skipnav" href="#main-content">
        Skip to main content
      </a>
      <header className="cf-header">
        <div className="grid-container-widescreen cf-header__inner">
          <div>
            <Link to="/" className="cf-brand">
              CaseFlow
            </Link>
            <span className="cf-brand__sub">SNAP casework · Arlington County DHS (demo)</span>
          </div>
          <nav aria-label="Primary" className="cf-nav">
            <NavLink to="/" end>
              Work queue
            </NavLink>
            <NavLink to="/policy">Policy versions</NavLink>
          </nav>
          <div className="cf-user">
            <label htmlFor="bps-user" className="cf-user__label">
              Signed in as
            </label>
            <Select id="bps-user" name="bps-user" value={user} onChange={(e) => setCurrentUser(e.target.value)} className="cf-user__select">
              {BPS_USERS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} (BPS)
                </option>
              ))}
            </Select>
          </div>
        </div>
      </header>
      <div className="cf-demo-banner" role="note">
        <div className="grid-container-widescreen">
          <strong>Independent demo.</strong> Modeled on Arlington County DHS and Virginia Department of Social Services SNAP workflows. Not
          affiliated with Arlington County, VDSS, or the Virginia Employment Commission. Synthetic data only.
        </div>
      </div>
      <main id="main-content" className="grid-container-widescreen padding-y-4">
        <Routes>
          <Route path="/" element={<QueuePage />} />
          <Route path="/cases/:caseNumber" element={<CasePage />} />
          <Route path="/policy" element={<PoliciesPage />} />
          <Route path="*" element={<p>Page not found. <Link to="/">Back to the work queue</Link></p>} />
        </Routes>
      </main>
    </>
  );
}
