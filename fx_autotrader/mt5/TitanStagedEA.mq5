//+------------------------------------------------------------------+
//| TitanStagedEA.mq5                                                |
//| Multi-symbol, staged-risk Expert Advisor for Titan FX MT5         |
//| (JPY account, Zero Blade).  Rules mirror fx_autotrader/fxlab.     |
//+------------------------------------------------------------------+
#property copyright "fx_autotrader"
#property version   "1.00"
#property description "Staged-risk multi-symbol EA. Decisions on closed bars, server-side stop on every position."

#include <Trade\Trade.mqh>

//==================================================================== inputs
input group "=== Symbols ==="
input string InpSymbols        = "USDJPY,EURUSD,GBPUSD,AUDUSD,USDCAD,EURJPY,GBPJPY,AUDJPY,XAUUSD"; // comma separated, no suffix
input string InpSymbolSuffix   = "";          // e.g. ".b" if the broker adds a suffix
input long   InpMagic          = 26092501;

input group "=== Risk (stages) ==="
input double InpRiskPct        = 1.0;         // risk per trade (% of balance) below the first stage
input string InpStages         = "2000000:1.0;10000000:0.75;30000000:0.5"; // balance:risk% ; ...
input double InpMaxOpenRiskPct = 8.0;         // sum of initial risk of open trades (% of balance)
input int    InpMaxPositions   = 10;          // max simultaneous positions opened by this EA
input double InpDD1Pct         = 15.0;        // balance drawdown from peak that triggers throttle 1
input double InpDD1Mult        = 0.5;         // risk multiplier at throttle 1
input double InpDD2Pct         = 25.0;
input double InpDD2Mult        = 0.25;
input double InpHaltDDPct      = 40.0;        // equity DD from peak -> close all and stop trading
input double InpDailyLossPct   = 4.0;         // equity loss in one server day -> no new entries today
input double InpMarginUsePct   = 50.0;        // max margin use (% of equity)

input group "=== Execution ==="
input double InpMaxSpreadPips  = 3.0;         // skip entries when spread is wider (gold uses x20)
input int    InpDeviationPts   = 30;          // max slippage (points) for market orders
input bool   InpAvoidRollover  = true;        // no orders in the server 00:00 hour (rollover spreads, gold closed); act at 01:00
input int    InpTimerSec       = 10;
input bool   InpLogCsv         = true;

input group "=== Strategy ==="
input ENUM_TIMEFRAMES InpSignalTF = PERIOD_D1;
input int    InpEntryN         = 55;          // placeholder reference rules (replaced by final strategy)
input int    InpExitN          = 20;
input int    InpAtrN           = 20;
input double InpStopAtr        = 2.0;
input double InpTrailAtr       = 0.0;         // 0 = no trailing
input int    InpMaxHoldBars    = 0;           // 0 = no time stop

//==================================================================== types
struct Decision
  {
   bool   long_entry;
   bool   short_entry;
   bool   exit_long;
   bool   exit_short;
   double stop_dist;      // price units
   double trail_dist;     // price units, 0 = none
   double tp_dist;        // price units, 0 = none
   double long_stop_px;   // 0 = market order
   double short_stop_px;  // 0 = market order
   int    max_hold;       // signal bars, 0 = none
  };

struct SymState
  {
   string   name;
   datetime last_bar;     // open time of the last signal bar already processed
  };

//==================================================================== globals
CTrade    g_trade;
SymState  g_syms[];
double    g_stage_bal[];
double    g_stage_risk[];
string    g_gv_peak, g_gv_halt, g_gv_day, g_gv_daybal;
int       g_csv = INVALID_HANDLE;

//==================================================================== helpers
double PipSize(const string sym)
  {
   string base = StringSubstr(sym, 0, 3);
   string quote = StringSubstr(sym, 3, 3);
   if(base == "XAU" || base == "XAG") return 0.01;
   if(quote == "JPY") return 0.01;
   return 0.0001;
  }

void Log(const string what, const string sym, const string detail)
  {
   string line = StringFormat("%s,%s,%s,%s", TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS), what, sym, detail);
   Print(line);
   if(InpLogCsv && g_csv != INVALID_HANDLE)
     {
      FileWrite(g_csv, line);
      FileFlush(g_csv);
     }
  }

bool ParseStages()
  {
   ArrayResize(g_stage_bal, 0);
   ArrayResize(g_stage_risk, 0);
   string parts[];
   int n = StringSplit(InpStages, ';', parts);
   for(int i = 0; i < n; i++)
     {
      string kv[];
      if(StringSplit(parts[i], ':', kv) != 2) continue;
      int k = ArraySize(g_stage_bal);
      ArrayResize(g_stage_bal, k + 1);
      ArrayResize(g_stage_risk, k + 1);
      g_stage_bal[k]  = StringToDouble(kv[0]);
      g_stage_risk[k] = StringToDouble(kv[1]);
     }
   return true;
  }

double GvGet(const string name, const double def)
  {
   if(GlobalVariableCheck(name)) return GlobalVariableGet(name);
   GlobalVariableSet(name, def);
   return def;
  }

//--- risk fraction for the current account state (stage x drawdown throttle)
double RiskFraction(const double balance, const double peak)
  {
   double r = InpRiskPct;
   for(int i = 0; i < ArraySize(g_stage_bal); i++)
      if(balance >= g_stage_bal[i]) r = g_stage_risk[i];
   double dd = (peak > 0.0) ? 100.0 * (1.0 - balance / peak) : 0.0;
   double mult = 1.0;
   if(dd >= InpDD1Pct) mult = InpDD1Mult;
   if(dd >= InpDD2Pct) mult = InpDD2Mult;
   return r * mult / 100.0;
  }

//--- account-currency loss of 1.00 lot moving `dist` price units against us
double LossPerLot(const string sym, const double dist)
  {
   double tick_size  = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   double tick_value = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tick_value <= 0.0) tick_value = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
   if(tick_size <= 0.0 || tick_value <= 0.0) return 0.0;
   return dist / tick_size * tick_value;
  }

double NormalizeLots(const string sym, double lots)
  {
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(step <= 0.0) step = 0.01;
   lots = MathFloor(lots / step + 1e-9) * step;
   if(lots < vmin) return 0.0;
   return MathMin(lots, vmax);
  }

//--- positions / orders owned by this EA
int CountPositions(const string sym, long &type, ulong &ticket)
  {
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !PositionSelectByTicket(t)) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(sym != "" && PositionGetString(POSITION_SYMBOL) != sym) continue;
      n++;
      type = PositionGetInteger(POSITION_TYPE);
      ticket = t;
     }
   return n;
  }

//--- sum of the initial risk (stored in the comment as "r=<jpy>") of open positions
double OpenRiskJpy()
  {
   double total = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !PositionSelectByTicket(t)) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      string c = PositionGetString(POSITION_COMMENT);
      int p = StringFind(c, "r=");
      if(p >= 0) total += StringToDouble(StringSubstr(c, p + 2));
      else
        {
         string sym = PositionGetString(POSITION_SYMBOL);
         double d = MathAbs(PositionGetDouble(POSITION_PRICE_OPEN) - PositionGetDouble(POSITION_SL));
         total += LossPerLot(sym, d) * PositionGetDouble(POSITION_VOLUME);
        }
     }
   return total;
  }

void DeletePendingOrders(const string sym)
  {
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t == 0 || !OrderSelect(t)) continue;
      if(OrderGetInteger(ORDER_MAGIC) != InpMagic) continue;
      if(OrderGetString(ORDER_SYMBOL) != sym) continue;
      if(!g_trade.OrderDelete(t)) Log("ERR_DELETE", sym, IntegerToString(g_trade.ResultRetcode()));
     }
  }

void CloseAll(const string why)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !PositionSelectByTicket(t)) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      g_trade.SetTypeFillingBySymbol(sym);
      if(g_trade.PositionClose(t, InpDeviationPts)) Log("CLOSE", sym, why);
      else Log("ERR_CLOSE", sym, IntegerToString(g_trade.ResultRetcode()));
     }
   for(int k = 0; k < ArraySize(g_syms); k++) DeletePendingOrders(g_syms[k].name);
  }

//==================================================================== indicators (match fxlab/indicators.py)
// All functions take rates[] in *series* order (index 1 = last closed bar).
double AtrSma(const MqlRates &r[], const int shift, const int n)
  {
   double s = 0.0;
   for(int i = shift; i < shift + n; i++)
     {
      double pc = r[i + 1].close;
      double tr = MathMax(r[i].high - r[i].low, MathMax(MathAbs(r[i].high - pc), MathAbs(r[i].low - pc)));
      s += tr;
     }
   return s / n;
  }

double HighestHigh(const MqlRates &r[], const int from, const int n)
  {
   double h = -DBL_MAX;
   for(int i = from; i < from + n; i++) h = MathMax(h, r[i].high);
   return h;
  }

double LowestLow(const MqlRates &r[], const int from, const int n)
  {
   double l = DBL_MAX;
   for(int i = from; i < from + n; i++) l = MathMin(l, r[i].low);
   return l;
  }

//==================================================================== strategy
// Fill `d` from the last CLOSED signal bar (series index 1).  Must mirror the
// Python strategy exactly.  (Reference rules - replaced by the final strategy.)
bool ComputeDecision(const string sym, Decision &d)
  {
   ZeroMemory(d);
   int need = MathMax(InpEntryN, MathMax(InpExitN, InpAtrN)) + 5;
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(sym, InpSignalTF, 0, need + 2, r) < need + 2) return false;
   double close1 = r[1].close;
   double hiN = HighestHigh(r, 2, InpEntryN);
   double loN = LowestLow(r, 2, InpEntryN);
   double hiX = HighestHigh(r, 2, InpExitN);
   double loX = LowestLow(r, 2, InpExitN);
   double atr = AtrSma(r, 1, InpAtrN);
   d.long_entry  = close1 > hiN;
   d.short_entry = close1 < loN;
   d.exit_long   = close1 < loX;
   d.exit_short  = close1 > hiX;
   d.stop_dist   = InpStopAtr * atr;
   d.trail_dist  = InpTrailAtr * atr;
   d.max_hold    = InpMaxHoldBars;
   return d.stop_dist > 0.0;
  }

//==================================================================== trading
bool SpreadOk(const string sym)
  {
   double spread = SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID);
   double lim = InpMaxSpreadPips * PipSize(sym) * (StringSubstr(sym, 0, 3) == "XAU" ? 20.0 : 1.0);
   return spread <= lim;
  }

double LotsFor(const string sym, const double stop_dist, double &risk_jpy)
  {
   double bal  = AccountInfoDouble(ACCOUNT_BALANCE);
   double peak = GvGet(g_gv_peak, bal);
   double rf   = RiskFraction(bal, peak);
   double budget = MathMin(bal * rf, bal * InpMaxOpenRiskPct / 100.0 - OpenRiskJpy());
   if(budget <= 0.0) return 0.0;
   double spread = SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID);
   double per_lot = LossPerLot(sym, stop_dist + spread);
   if(per_lot <= 0.0) return 0.0;
   double lots = NormalizeLots(sym, budget / per_lot);
   // margin check
   double price = SymbolInfoDouble(sym, SYMBOL_ASK), margin = 0.0;
   if(lots > 0.0 && OrderCalcMargin(ORDER_TYPE_BUY, sym, lots, price, margin))
     {
      double free_cap = AccountInfoDouble(ACCOUNT_EQUITY) * InpMarginUsePct / 100.0 - AccountInfoDouble(ACCOUNT_MARGIN);
      if(margin > free_cap && margin > 0.0) lots = NormalizeLots(sym, lots * free_cap / margin);
     }
   risk_jpy = lots * per_lot;
   return lots;
  }

bool EntryAllowed()
  {
   if(GvGet(g_gv_halt, 0.0) > 0.0) return false;
   long type; ulong tk;
   if(CountPositions("", type, tk) >= InpMaxPositions) return false;
   double daybal = GvGet(g_gv_daybal, AccountInfoDouble(ACCOUNT_BALANCE));
   if(AccountInfoDouble(ACCOUNT_EQUITY) < daybal * (1.0 - InpDailyLossPct / 100.0)) return false;
   return true;
  }

void OpenMarket(const string sym, const int dir, const Decision &d)
  {
   if(!EntryAllowed() || !SpreadOk(sym)) { Log("SKIP", sym, "entry filter"); return; }
   double risk_jpy = 0.0;
   double lots = LotsFor(sym, d.stop_dist, risk_jpy);
   if(lots <= 0.0) { Log("SKIP", sym, "lots=0"); return; }
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double px = dir > 0 ? SymbolInfoDouble(sym, SYMBOL_ASK) : SymbolInfoDouble(sym, SYMBOL_BID);
   double sl = NormalizeDouble(px - dir * d.stop_dist, digits);
   double tp = d.tp_dist > 0.0 ? NormalizeDouble(px + dir * d.tp_dist, digits) : 0.0;
   string cmt = StringFormat("TS r=%.0f", risk_jpy);
   g_trade.SetTypeFillingBySymbol(sym);
   bool ok = dir > 0 ? g_trade.Buy(lots, sym, 0.0, sl, tp, cmt) : g_trade.Sell(lots, sym, 0.0, sl, tp, cmt);
   Log(ok ? "OPEN" : "ERR_OPEN", sym, StringFormat("dir=%d lots=%.2f sl=%s tp=%s risk=%.0f rc=%d", dir, lots,
       DoubleToString(sl, digits), DoubleToString(tp, digits), risk_jpy, g_trade.ResultRetcode()));
  }

void PlaceStopOrder(const string sym, const int dir, const double level, const Decision &d)
  {
   if(!EntryAllowed()) return;
   double risk_jpy = 0.0;
   double lots = LotsFor(sym, d.stop_dist, risk_jpy);
   if(lots <= 0.0) return;
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double px = NormalizeDouble(level, digits);
   double sl = NormalizeDouble(px - dir * d.stop_dist, digits);
   double tp = d.tp_dist > 0.0 ? NormalizeDouble(px + dir * d.tp_dist, digits) : 0.0;
   string cmt = StringFormat("TS r=%.0f", risk_jpy);
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK), bid = SymbolInfoDouble(sym, SYMBOL_BID);
   bool ok;
   g_trade.SetTypeFillingBySymbol(sym);
   if(dir > 0 && ask >= px)      ok = g_trade.Buy(lots, sym, 0.0, NormalizeDouble(ask - d.stop_dist, digits), tp, cmt);
   else if(dir < 0 && bid <= px) ok = g_trade.Sell(lots, sym, 0.0, NormalizeDouble(bid + d.stop_dist, digits), tp, cmt);
   else if(dir > 0)              ok = g_trade.BuyStop(lots, px, sym, sl, tp, ORDER_TIME_GTC, 0, cmt);
   else                          ok = g_trade.SellStop(lots, px, sym, sl, tp, ORDER_TIME_GTC, 0, cmt);
   Log(ok ? "PLACE" : "ERR_PLACE", sym, StringFormat("dir=%d lots=%.2f level=%s rc=%d", dir, lots,
       DoubleToString(px, digits), g_trade.ResultRetcode()));
  }

//--- highest high / lowest low since the position was opened (H1 bars incl. the current one)
void ExtremesSince(const string sym, const datetime since, double &hh, double &ll)
  {
   MqlRates r[];
   int n = CopyRates(sym, PERIOD_H1, since, TimeCurrent(), r);
   hh = -DBL_MAX; ll = DBL_MAX;
   for(int i = 0; i < n; i++) { hh = MathMax(hh, r[i].high); ll = MathMin(ll, r[i].low); }
  }

void ProcessSymbol(SymState &s)
  {
   string sym = s.name;
   datetime bar0 = iTime(sym, InpSignalTF, 0);
   if(bar0 == 0 || bar0 == s.last_bar) return;
   if(InpAvoidRollover)
     {
      MqlDateTime now; TimeToStruct(TimeCurrent(), now);
      if(now.hour == 0) return;                                // same rule as fxlab map_decisions
     }
   Decision d;
   if(!ComputeDecision(sym, d)) return;
   s.last_bar = bar0;
   DeletePendingOrders(sym);                                   // stop-entry orders live one bar

   long type = -1; ulong ticket = 0;
   int npos = CountPositions(sym, type, ticket);
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   if(npos > 0 && PositionSelectByTicket(ticket))
     {
      int dir = (type == POSITION_TYPE_BUY) ? 1 : -1;
      double sl = PositionGetDouble(POSITION_SL);
      datetime opened = (datetime)PositionGetInteger(POSITION_TIME);
      bool closed = false;
      // trailing stop (only tightens)
      if(d.trail_dist > 0.0)
        {
         double hh, ll;
         ExtremesSince(sym, opened, hh, ll);
         double ns = dir > 0 ? hh - d.trail_dist : ll + d.trail_dist;
         ns = NormalizeDouble(ns, digits);
         if((dir > 0 && ns > sl) || (dir < 0 && (sl == 0.0 || ns < sl)))
           {
            double bid = SymbolInfoDouble(sym, SYMBOL_BID), ask = SymbolInfoDouble(sym, SYMBOL_ASK);
            bool beyond = dir > 0 ? bid <= ns : ask >= ns;
            if(beyond)
              {
               if(!g_trade.PositionClose(ticket, InpDeviationPts)) { Log("ERR_CLOSE", sym, "trail"); return; }
               Log("CLOSE", sym, "trail beyond price");
               closed = true;
              }
            else if(g_trade.PositionModify(ticket, ns, PositionGetDouble(POSITION_TP))) Log("TRAIL", sym, DoubleToString(ns, digits));
           }
        }
      if(!closed)
        {
         int held = iBarShift(sym, InpSignalTF, opened, false);   // signal bars since entry
         bool rev = (dir > 0 && d.short_entry && d.short_stop_px == 0.0) || (dir < 0 && d.long_entry && d.long_stop_px == 0.0);
         bool ex  = (dir > 0 && d.exit_long) || (dir < 0 && d.exit_short) || rev ||
                    (d.max_hold > 0 && held >= d.max_hold);
         if(!ex) return;                                          // still in a position: no entry
         g_trade.SetTypeFillingBySymbol(sym);
         if(!g_trade.PositionClose(ticket, InpDeviationPts))
           {
            Log("ERR_CLOSE", sym, IntegerToString(g_trade.ResultRetcode()));
            return;
           }
         Log("CLOSE", sym, rev ? "reverse" : "signal/time");
        }
      // fall through: like the backtest kernel, a new entry (stop-and-reverse or
      // re-entry while the entry signal holds) may open on the bar a position closed
     }
   // flat: entries
   bool mkt_long  = d.long_entry  && d.long_stop_px == 0.0;
   bool mkt_short = d.short_entry && d.short_stop_px == 0.0;
   if(mkt_long && !d.short_entry)       OpenMarket(sym, 1, d);
   else if(mkt_short && !d.long_entry)  OpenMarket(sym, -1, d);
   else
     {
      if(d.long_entry && d.long_stop_px > 0.0)   PlaceStopOrder(sym, 1, d.long_stop_px, d);
      if(d.short_entry && d.short_stop_px > 0.0) PlaceStopOrder(sym, -1, d.short_stop_px, d);
     }
  }

//--- OCO: when one stop-entry order fills, cancel the other side
void EnforceOco()
  {
   for(int k = 0; k < ArraySize(g_syms); k++)
     {
      long type; ulong tk;
      if(CountPositions(g_syms[k].name, type, tk) > 0) DeletePendingOrders(g_syms[k].name);
     }
  }

void UpdateAccountState()
  {
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   double peak = GvGet(g_gv_peak, bal);
   if(bal > peak) { peak = bal; GlobalVariableSet(g_gv_peak, peak); }
   // new server day -> reset the daily-loss reference
   MqlDateTime t; TimeToStruct(TimeCurrent(), t);
   double today = t.year * 10000.0 + t.mon * 100.0 + t.day;
   if(GvGet(g_gv_day, 0.0) != today) { GlobalVariableSet(g_gv_day, today); GlobalVariableSet(g_gv_daybal, bal); }
   // hard stop
   if(GvGet(g_gv_halt, 0.0) == 0.0 && eq < peak * (1.0 - InpHaltDDPct / 100.0))
     {
      GlobalVariableSet(g_gv_halt, 1.0);
      CloseAll("halt: equity drawdown limit");
      Alert("TitanStagedEA halted: equity drawdown limit reached. Review before resetting GV ", g_gv_halt);
     }
  }

//==================================================================== events
int OnInit()
  {
   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(InpDeviationPts);
   g_trade.SetMarginMode();
   string prefix = "TSEA_" + IntegerToString(InpMagic) + "_";
   g_gv_peak = prefix + "peak"; g_gv_halt = prefix + "halt";
   g_gv_day = prefix + "day";   g_gv_daybal = prefix + "daybal";
   ParseStages();
   if(AccountInfoString(ACCOUNT_CURRENCY) != "JPY")
      Print("warning: account currency is ", AccountInfoString(ACCOUNT_CURRENCY), " (risk inputs are still % of balance)");
   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
      Print("warning: account is not in hedging mode");
   string parts[];
   int n = StringSplit(InpSymbols, ',', parts);
   ArrayResize(g_syms, 0);
   for(int i = 0; i < n; i++)
     {
      string sym = parts[i];
      StringTrimLeft(sym); StringTrimRight(sym);
      if(sym == "") continue;
      sym += InpSymbolSuffix;
      if(!SymbolSelect(sym, true)) { Print("symbol not available: ", sym); continue; }
      int k = ArraySize(g_syms);
      ArrayResize(g_syms, k + 1);
      g_syms[k].name = sym;
      g_syms[k].last_bar = iTime(sym, InpSignalTF, 0);  // do not act on the bar that is already open
     }
   if(ArraySize(g_syms) == 0) return INIT_FAILED;
   if(InpLogCsv)
      g_csv = FileOpen("TitanStagedEA_" + IntegerToString(InpMagic) + ".csv",
                       FILE_WRITE | FILE_READ | FILE_CSV | FILE_ANSI | FILE_SHARE_READ, ',');
   if(g_csv != INVALID_HANDLE) FileSeek(g_csv, 0, SEEK_END);
   EventSetTimer(InpTimerSec);
   Log("INIT", "", StringFormat("symbols=%d balance=%.0f", ArraySize(g_syms), AccountInfoDouble(ACCOUNT_BALANCE)));
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(g_csv != INVALID_HANDLE) FileClose(g_csv);
  }

void OnTimer()
  {
   UpdateAccountState();
   if(GvGet(g_gv_halt, 0.0) > 0.0) return;
   EnforceOco();
   for(int k = 0; k < ArraySize(g_syms); k++) ProcessSymbol(g_syms[k]);
  }

void OnTick()
  {
   // the strategy is bar based; the Strategy Tester drives OnTimer as well.
  }
//+------------------------------------------------------------------+
