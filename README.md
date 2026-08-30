Ja, det er god praksis at have et direkte link og en hurtig onboarding-sektion i `README.md`, så alle i gruppen ser det med det samme på forsiden af repositoriet.

---

### Opdateret `README.md`

Åbn `README.md` og opdater indholdet til følgende:

```markdown
# Bifrost 🌉

Et system til håndtering og styring af afleveringer mellem studerende og undervisere. Projektet udvikles som et bachelorprojekt i softwareteknologi.

---

## Kom godt i gang

1. **Klon repositoriet:**
   ```bash
   git clone git@github.com:DIT-BRUGERNAVN/Bifrost.git
   cd Bifrost

```

2. **Aktivér Git-konfiguration og hooks:**
For at aktivere vores fælles aliases (`git sync`, `git pf`), rebase-indstillinger og automatiske Jira-commit-hooks lokalt, skal du køre følgende én gang:
```bash
git config --local include.path ../.gitconfig
chmod +x .githooks/prepare-commit-msg

```


3. **Læs vores Git-strategi:**
Se [GIT_STRATEGY.md](GIT_STRATEGY.md) for detaljer om vores branch-model, PR-flow, commit-konventioner og AI-review.

