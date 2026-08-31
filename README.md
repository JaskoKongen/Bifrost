# Bifrost 🌈

Et system til styring af kommunikation mellem studerende og undervisere. Projektet udvikles som et bachelorprojekt i softwareteknologi af Jonas, Jakob og Rune.

---

## Kom godt i gang

1. **Klon repositoriet:**
   ```bash
   git clone git@github.com:JaskoKongen/Bifrost.git
   cd Bifrost
   ```

2. **Aktivér Git-konfiguration og hooks:**
   
   For at aktivere vores fælles aliases (`git sync`, `git pf`), rebase-indstillinger og automatiske Jira-commit-hooks lokalt, skal du køre følgende én gang:
      ```bash
      git config --local include.path ../.gitconfig
      chmod +x .githooks/prepare-commit-msg
      ```
      <small>*(Bemærk: --local isolerer ændringerne udelukkende til dette repository og rører ikke dine globale Git-indstillinger).*</small>


3. **Læs vores Git-strategi:**

   Se [GIT_STRATEGY.md](GIT_STRATEGY.md) for detaljer om vores branch-model, PR-flow, commit-konventioner og AI-review.

