---
name: egx-portfolio
description: Reading and discussing the user's manually entered EGX30 portfolio — add, edit or remove holdings and explain value, P/L, weights, fair values, ratings and protection prices. Use when the user mentions their holdings, portfolio, محفظة, or how much they invested.
---

# Portfolio discussion

The user enters their own holdings; the tool never connects to a broker. The user is responsible for the accuracy of what they enter.

- Add: `portfolio_add(symbol, buy_price, invested_amount=...)` when the user gives an amount ("50 EGP in X"), or `quantity=...` when they give shares. Always ask for the buy price if it is missing; do not assume today's price.
- Edit / remove: `portfolio_update`, `portfolio_remove` with the holding id from `portfolio_summary`.
- Read: `portfolio_summary`, then explain:
  - total cost, market value and P/L, and holdings without a price;
  - each holding's weight, and concentration (any single stock above roughly a third of the portfolio);
  - for each holding with a valuation: fair value, risk rating, protection price and where the price sits; for holdings below protection, the two explanations from the critic notes (`get_latest_valuation`);
  - holdings with no valuation yet, offering to run `egx-valuation`.
- Stay descriptive. You may compare a holding's expected return (upside to fair value plus dividend yield) with the bank-certificate rate if the user provides it, but do not tell the user to buy, sell, hold or rebalance.
