# Mobile-first UX redesign

## Purpose

The app is used on a phone to check portfolio health, and sometimes to edit a holding or the FIRE plan. Those two jobs are awkward today: Portfolio stacks summary cards, income, charts, and accounts on one page, and FIRE leads with a long assumptions form before the result.

This redesign reorganises the existing screens. It does not change the portfolio maths, the FIRE engine, Monte Carlo, currency conversion, or how data is saved.

## Success criteria

- A health check is visible without scrolling: total, gain, accessible versus pension, price freshness, FIRE age, and ISA allowance left.
- A common holding edit is Holdings, the account, the holding, change units or cost, Save.
- A common plan change is Plan, Adjust, change spending or a contribution, Done. The result is visible while typing. Leaving Adjust with the browser back keeps the typed value, because Adjust has already saved it.

## Information architecture

Three destinations. Look-through is not a tab.

| Tab | Route | Job |
| --- | --- | --- |
| Home | `/` | Health check |
| Holdings | `/holdings` | Accounts, then everything else about the portfolio |
| Plan | `/fire` | FIRE result |

Phone: bottom navigation, with the existing safe-area inset. Desktop: the same three items in the top bar. The header keeps the price-refresh button and the settings menu (currency, export, import, sign out, and Fund Holdings for the admin).

Full-screen forms hide the tab bar and replace the app header with Cancel, a title, and Save or Done. Other screens keep the header and the tab bar.

| Screen | Route | Commit |
| --- | --- | --- |
| Add or edit account | `/holdings/new`, `/holdings/:id/edit` | Save commits. Cancel discards. `/holdings/new` is matched before `/holdings/:id`. |
| Account | `/holdings/:id` | — |
| Add or edit holding | `/holdings/:id/holdings/new`, `/holdings/:id/holdings/:holdingId` | Save commits. Cancel discards. |
| Exposure | `/lookthrough` | Unchanged page. Reached from Holdings, not the tab bar. |
| Adjust plan | `/fire/adjust` | Writes as you type, same as today. Done returns to Plan. |
| More assumptions | `/fire/assumptions` | Writes as you type. Done returns to Adjust. |
| ISA contribution | `/allowance` | Save commits. Cancel discards. |

`/funds` stays in the settings menu for the admin.

## Home

No scroll on a phone.

- Label, total value, gain in money and percent.
- One line: accessible value (ISA, GIA, cash) and pension value.
- "Prices updated" with the time of the last refresh.
- FIRE age tile. Opens Plan.
- ISA left tile, with the allowance bar. Opens the contribution screen.
- Green and red are used only for the gain.

Charts, the account list, income, rebalance, and the safe-withdrawal cards are not on Home.

If there are no accounts, Home shows £0, no gain line, and one action: Add an account. The FIRE and ISA tiles still show when saved plan settings or a contribution exist.

## Holdings

The list is accounts, not an accordion.

- Exposure row at the top. Opens `/lookthrough`.
- One row per account: colour, name, owner, account type, value, gain. The whole row opens the account.
- Owner and type filters stay, as one wrapping row of chips, only when more than one owner or type exists.
- Add account at the bottom of the list. The form is the current fields: platform name, owner, account type, colour. Full screen.
- Below the list, in this order: income, allocation charts, rebalance, performance, the safe-withdrawal and estimated-earnings cards, and the per-account allocation bars. Nothing from the current Portfolio page is removed. It just stops competing with the health check and the account list.

The account screen:

- Back, account name, value, gain.
- One row per holding: name, ticker, units, value, gain. The whole row opens edit. Edit loads the stored holding, not the display-currency copy.
- Add holding, fixed at the bottom.
- Import CSV on this screen, not on the list. Replace and merge behave as they do now.
- Edit and delete account are on this screen. Delete still asks for confirmation.

The holding form is the current form, full screen: search, units, cost, manual value when there is no live price, currency. Cash accounts keep the cash fields (name, balance, currency). Delete is a text button at the bottom of edit, and still asks for confirmation. It is not an icon on the list.

## Plan

Plan is GBP, as it is today.

The headline is first:

- Earliest or Chosen age, on this screen. It changes what the headline means.
- Earliest mode: FIRE age, confidence, and the monthly saving that would hold that age, including the difference from today's contributions.
- Chosen-age mode: target age, confidence, and required monthly saving, with the same comparison.
- While a new result calculates, the previous numbers stay and dim, with a "Calculating…" label. The first result can show a working state. If calculation fails, the headline says it could not compute, including the existing on-device fallback note.
- Cash, ISA, GIA, and pension balances sit under the headline. Contribution inputs are not on these cards.
- Adjust plan opens the short form.
- Below that: the confidence-by-age chart, market-risk chart, projection (split and combined), and the year-by-year table.

Adjust, in order:

- The live result (age and confidence).
- Spending per year.
- Monthly ISA contribution.
- Monthly pension contribution.
- Retire-at age. Shown in both modes so a chosen age can be set before switching.
- More assumptions.

More assumptions holds the remaining fields, unchanged: current age, equity return, cash return, inflation, pension access age, target confidence, plan-to age, equity volatility, pension drawdown tax, GIA CGT, safe withdrawal rate, and state pension (on/off, amount, from age).

## ISA contribution

Opened from the Home tile. It shows the tax year, days left, amount remaining, and the allowance bar. One field sets the total contributed for that year. "Add a previous year" works as it does now. This is not a list of individual deposits.

## When something is wrong

- Stale prices: the total still shows. Home puts "Prices may be stale" under the updated time. Other tabs show that line at the top of the page. Refresh stays in the header.
- Server unreachable: the existing amber banner, read-only, with Retry. Edits and saves are blocked.
- Changed on another device: the existing red banner. Edits on this device are not saved. Reload loads the other copy.
- Delete always confirms.
- These banners sit under the header and above the page content.

## What does not change

- Portfolio valuation, snapshots, live prices, FX, and the rule that FIRE runs on the GBP view.
- FIRE projection, Monte Carlo, and the worker fallback.
- Supabase load, debounced save, conflict handling, and the local cache.
- Auth.
- Look-through contents, fund-holdings upload, and the admin-only `/funds` route.
- Colours and type. Amber for stale or offline warnings. Red for the conflict banner and destructive confirmation. Green and red elsewhere only for gains and losses.

## Testing

- Existing Vitest suites stay green. This work adds no money maths.
- Check on a phone-width viewport: Home needs no scroll; a holding edit is the four-step path above; Adjust updates the Plan headline while typing; Cancel on a holding form does not write; Done on Adjust leaves the typed value saved.
- Check the empty portfolio, stale-price line, read-only banner, and conflict banner.
- Check desktop width: the same screens, tabs in the header, no bottom bar.

## Out of scope

- A new visual theme, palette, or typeface.
- Changing FIRE maths, contribution storage, or sync behaviour.
- A fourth tab, or putting Look-through back in the tab bar.
- Per-deposit ISA contribution history.
