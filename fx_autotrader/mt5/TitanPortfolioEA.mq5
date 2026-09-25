//+------------------------------------------------------------------+
//| TitanPortfolioEA.mq5  v1.10                                      |
//| Staged-risk portfolio EA for Titan FX MT5 (JPY account, Blade)   |
//|   1) GOTOBI   : USDJPY short at the 09:55 JST Tokyo fix on       |
//|                 Japanese gotobi days, flat at 15:00 JST (LIVE)   |
//|   2) MEANREV  : D1 Bollinger re-entry on 5 majors (DEMO ONLY -   |
//|                 failed 1976-2004 and 2020-2026 checks)           |
//|   3) CARRY    : D1 carry with trend/vol protection (IDLE until a |
//|                 pair's previous-year rate differential >= 4%)    |
//| Rules mirror fx_autotrader/fxlab (Python backtest); see          |
//| docs/EA_MANUAL.md.  Every position carries a server-side stop    |
//| from the moment it is opened.  No martingale/grid/averaging.     |
//+------------------------------------------------------------------+
#property copyright "fx_autotrader"
#property version   "1.10"
#property description "Gotobi (+ optional D1 mean reversion / carry) with staged risk for Titan FX MT5 (JPY, hedging account)."

#include <Trade\Trade.mqh>

//==================================================================== inputs
input group "=== General ==="
input string InpSymbolSuffix    = "";        // e.g. "-m" on Micro accounts; "" on Standard/Blade
input long   InpMagicBase       = 26092600;  // magics: base+1 gotobi, base+2 meanrev, base+3 carry
input int    InpServerDST       = 0;         // tester clock rule: 0 = NY+7h (US DST), 1 = EU DST, 2 = fixed GMT+2, 3 = fixed GMT+3
input bool   InpLogCsv          = true;

input group "=== Books (risk per trade in % of balance) ==="
input bool   InpGotobiOn        = true;
input double InpGotobiRiskPct   = 0.5;       // stage 1: 0.5 ; stage 2: 1.0 ; hard ceiling while gotobi trades alone: 1.25
input bool   InpMeanRevOn       = false;     // demo account only
input double InpMeanRevRiskPct  = 0.25;
input bool   InpCarryOn         = false;     // enable only when a pair qualifies AND balance >= 1,000,000 JPY
input double InpCarryRiskPct    = 0.5;
input double InpCarryBookCapPct = 2.0;       // max initial risk of all open carry positions (% of balance)

input group "=== Account risk ==="
input string InpStages          = "0:1.0";   // balanceJPY:multiplier;...  keep "0:1.0" and raise risk by hand (docs/STAGED_PLAN.md)
input double InpMaxOpenRiskPct  = 8.0;       // sum of initial risk of open positions (% of balance)
input int    InpMaxPositions    = 10;
input double InpThrottleDDPct   = 4.0;       // balance DD from peak -> all risk x InpThrottleMult (8x per-trade risk)
input double InpThrottleMult    = 0.5;
input double InpHaltDDPct       = 6.0;       // equity DD from peak -> close all and stop (12x per-trade risk)
input double InpDailyLossPct    = 3.0;       // equity loss within a server day -> no new entries that day
input double InpMarginUsePct    = 50.0;

input group "=== Execution ==="
input int    InpDeviationPts    = 20;
input double InpMaxSpreadPips   = 2.0;       // D1 books: skip entries above this spread

input group "=== GOTOBI book ==="
input string InpGotobiSymbol    = "USDJPY";
input int    InpGotobiEntrySec  = 35700;     // 09:55:00 JST (seconds after midnight)
input int    InpGotobiWindowSec = 60;        // entry window [09:55:00, 09:56:00); missed -> skip the day
input int    InpGotobiExitSec   = 54000;     // 15:00:00 JST
input double InpGotobiStopAtr   = 0.5;       // x D1 ATR(14) of the last closed D1 bar
input double InpGotobiMaxSpread = 0.7;       // pips; the OOS edge is ~2 pips per trade
input bool   InpGotobiSkipDec25 = true;      // the backtest has no Dec-25 trades 2012-2019
input string InpJpExtraHolidays = "";        // extra Japanese non-business days "YYYY.MM.DD;YYYY.MM.DD"

input group "=== MEANREV book (D1, demo only) ==="
input string InpMrSymbols       = "USDJPY,EURUSD,GBPUSD,AUDUSD,USDCAD";
input int    InpMrBbN           = 20;
input double InpMrBbK           = 1.5;
input int    InpMrAdxN          = 14;
input double InpMrAdxMax        = 25.0;
input int    InpMrAtrN          = 14;
input int    InpMrVolN          = 100;
input double InpMrVolMax        = 1.0;
input int    InpMrEmaN          = 200;
input double InpMrFlatK         = 3.0;
input int    InpMrExitN         = 20;
input double InpMrStopAtr       = 2.5;
input int    InpMrMaxHold       = 10;

input group "=== CARRY book (D1) ==="
input string InpCarrySymbols    = "USDJPY,EURUSD,GBPUSD,AUDUSD,USDCAD,EURJPY,GBPJPY,AUDJPY,CADJPY,EURGBP,EURAUD,GBPAUD,EURCAD,AUDCAD,GBPCAD";
// COMPLETED calendar years only: daily average over Jan 1..Dec 31, 2 decimals.  USD=EFFR, EUR=ECB deposit rate,
// JPY=BoJ policy rate, GBP=Bank Rate, AUD=RBA cash rate, CAD=BoC overnight target.  Add the new row every January.
input string InpRates           = "2024:USD=5.14,EUR=3.73,JPY=0.10,GBP=5.11,AUD=4.35,CAD=4.55;2025:USD=4.21,EUR=2.26,JPY=0.49,GBP=4.25,AUD=3.88,CAD=2.70";
input double InpCarryMinDiff    = 4.0;
input int    InpCarryEmaN       = 50;
input int    InpCarryVolFast    = 20;
input int    InpCarryVolSlow    = 250;
input double InpCarryVolEntry   = 1.0;
input double InpCarryVolExit    = 1.5;
input int    InpCarryAtrN       = 20;
input double InpCarryStopAtr    = 2.0;
input double InpCarryTrailAtr   = 3.0;

//==================================================================== types / globals
struct D1State
  {
   string   sym;
   datetime last_bar;
   string   gv;        // global variable that persists last_bar across restarts
  };

CTrade    g_trade;
D1State   g_mr[];
D1State   g_carry[];
string    g_gotobi_sym = "";
double    g_stage_bal[];
double    g_stage_mult[];
string    g_gv_balpeak, g_gv_eqpeak, g_gv_halt, g_gv_day, g_gv_daybal, g_gv_gotobi_day, g_gv_ratewarn;
int       g_csv = INVALID_HANDLE;
datetime  g_extra_hol[];
bool      g_tester = false;
// gotobi mechanism monitor (per JST day)
datetime  g_mech_day = 0;
double    g_mech_mid0955 = 0.0;
bool      g_mech_done = false;
datetime  g_clock_warn_day = 0;
string    g_last_skip = "";
datetime  g_last_skip_t = 0;

long MagicGotobi()  { return InpMagicBase + 1; }
long MagicMeanRev() { return InpMagicBase + 2; }
long MagicCarry()   { return InpMagicBase + 3; }

//==================================================================== logging / utils
datetime Now() { return g_tester ? TimeCurrent() : TimeTradeServer(); }

void Log(const string what, const string sym, const string detail)
  {
   if(what == "SKIP")
     {
      string key = sym + "|" + detail;
      if(key == g_last_skip && Now() - g_last_skip_t < 300) return;
      g_last_skip = key; g_last_skip_t = Now();
     }
   string line = StringFormat("%s,%s,%s,%s", TimeToString(Now(), TIME_DATE | TIME_SECONDS), what, sym, detail);
   Print(line);
   if(InpLogCsv && g_csv != INVALID_HANDLE) { FileWrite(g_csv, line); FileFlush(g_csv); }
  }

double GvGet(const string name, const double def)
  {
   if(GlobalVariableCheck(name)) return GlobalVariableGet(name);
   GlobalVariableSet(name, def);
   return def;
  }

double PipSize(const string sym)
  {
   string base = StringSubstr(sym, 0, 3), quote = StringSubstr(sym, 3, 3);
   if(base == "XAU" || base == "XAG") return 0.01;
   return quote == "JPY" ? 0.01 : 0.0001;
  }

double SpreadPips(const string sym)
  {
   return (SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID)) / PipSize(sym);
  }

datetime MakeDate(const int y, const int m, const int d)
  {
   MqlDateTime t; ZeroMemory(t);
   t.year = y; t.mon = m; t.day = d;
   return StructToTime(t);
  }

int Dow(const datetime t) { MqlDateTime s; TimeToStruct(t, s); return s.day_of_week; }   // 0=Sun..6=Sat
datetime DayStart(const datetime t) { return t - (t % 86400); }

int DaysInMonth(const int y, const int m)
  {
   int dm[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
   if(m == 2 && ((y % 4 == 0 && y % 100 != 0) || y % 400 == 0)) return 29;
   return dm[m - 1];
  }

//==================================================================== clocks
datetime NthSunday(const int y, const int m, const int n)
  {
   datetime first = MakeDate(y, m, 1);
   int add = (7 - Dow(first)) % 7;
   return first + (add + 7 * (n - 1)) * 86400;
  }

datetime LastSunday(const int y, const int m)
  {
   datetime last = MakeDate(y, m, DaysInMonth(y, m));
   return last - Dow(last) * 86400;
  }

// server clock offset from UTC by rule (2 or 3).  The switch happens on a Sunday while
// the market is closed, so a date-based test is exact for every trading minute.
int RuleOffset(const datetime server)
  {
   MqlDateTime s; TimeToStruct(server, s);
   datetime d = DayStart(server);
   bool summer = false;
   if(InpServerDST == 0)
     {
      if(s.year >= 2007) summer = d >= NthSunday(s.year, 3, 2) && d < NthSunday(s.year, 11, 1);
      else               summer = d >= NthSunday(s.year, 4, 1) && d < LastSunday(s.year, 10);
     }
   else if(InpServerDST == 1) summer = d >= LastSunday(s.year, 3) && d < LastSunday(s.year, 10);
   else if(InpServerDST == 3) summer = true;
   return summer ? 3 : 2;
  }

// live broker offset (2 or 3), 0 if unavailable/implausible
int LiveOffset()
  {
   if(g_tester) return 0;
   long diff = (long)TimeTradeServer() - (long)TimeGMT();
   int h = (int)MathRound(diff / 3600.0);
   return (h == 2 || h == 3) ? h : 0;
  }

// offset used for JST; `ok` is false when live and rule disagree (gotobi skips that day)
int ServerOffset(const datetime server, bool &ok)
  {
   int rule = RuleOffset(server);
   ok = true;
   if(g_tester) return rule;
   int live = LiveOffset();
   if(live == 0 || live != rule)
     {
      ok = false;
      datetime d = DayStart(server);
      if(g_clock_warn_day != d)
        {
         g_clock_warn_day = d;
         Log("CLOCK", "", StringFormat("live offset GMT+%d differs from rule GMT+%d (InpServerDST=%d): gotobi skipped today",
             live, rule, InpServerDST));
        }
      return live != 0 ? live : rule;
     }
   return rule;
  }

datetime ServerToJst(const datetime server, bool &ok) { return server + (9 - ServerOffset(server, ok)) * 3600; }

//==================================================================== Japanese calendar (port of fxlab/strategies/seasonality.py)
datetime NthMonday(const int y, const int m, const int n)
  {
   datetime first = MakeDate(y, m, 1);
   int add = (8 - Dow(first)) % 7;
   return first + (add + 7 * (n - 1)) * 86400;
  }

bool InList(const datetime &arr[], const datetime d)
  {
   for(int i = 0; i < ArraySize(arr); i++) if(arr[i] == d) return true;
   return false;
  }

void AddDate(datetime &arr[], const datetime d)
  {
   if(InList(arr, d)) return;
   int k = ArraySize(arr);
   ArrayResize(arr, k + 1);
   arr[k] = d;
  }

// Japanese national holidays of year y (verified 2004-2030 against python-holidays / jpholiday)
void JpHolidays(const int y, datetime &h[])
  {
   ArrayResize(h, 0);
   AddDate(h, MakeDate(y, 1, 1));
   AddDate(h, NthMonday(y, 1, 2));
   AddDate(h, MakeDate(y, 2, 11));
   AddDate(h, MakeDate(y, 3, (int)MathFloor(20.8431 + 0.242194 * (y - 1980) - (int)((y - 1980) / 4))));
   AddDate(h, MakeDate(y, 4, 29));
   AddDate(h, MakeDate(y, 5, 3));
   AddDate(h, MakeDate(y, 5, 4));
   AddDate(h, MakeDate(y, 5, 5));
   AddDate(h, MakeDate(y, 9, (int)MathFloor(23.2488 + 0.242194 * (y - 1980) - (int)((y - 1980) / 4))));
   AddDate(h, MakeDate(y, 11, 3));
   AddDate(h, MakeDate(y, 11, 23));
   if(y <= 2018) AddDate(h, MakeDate(y, 12, 23));
   if(y >= 2020) AddDate(h, MakeDate(y, 2, 23));
   if(y == 2020) { AddDate(h, MakeDate(2020, 7, 23)); AddDate(h, MakeDate(2020, 7, 24)); AddDate(h, MakeDate(2020, 8, 10)); }
   else if(y == 2021) { AddDate(h, MakeDate(2021, 7, 22)); AddDate(h, MakeDate(2021, 7, 23)); AddDate(h, MakeDate(2021, 8, 8)); }
   else
     {
      AddDate(h, NthMonday(y, 7, 3));
      AddDate(h, NthMonday(y, 10, 2));
      if(y >= 2016) AddDate(h, MakeDate(y, 8, 11));
     }
   AddDate(h, NthMonday(y, 9, 3));
   if(y == 2019) { AddDate(h, MakeDate(2019, 4, 30)); AddDate(h, MakeDate(2019, 5, 1)); AddDate(h, MakeDate(2019, 5, 2)); AddDate(h, MakeDate(2019, 10, 22)); }
   int n0 = ArraySize(h);
   datetime base[]; ArrayResize(base, n0);
   for(int i = 0; i < n0; i++) base[i] = h[i];
   for(int i = 0; i < n0; i++)                       // citizens' holiday
     {
      datetime mid = base[i] + 86400;
      if(!InList(h, mid) && InList(h, mid + 86400) && Dow(mid) != 0) AddDate(h, mid);
     }
   int n1 = ArraySize(h);
   datetime snap[]; ArrayResize(snap, n1);
   for(int i = 0; i < n1; i++) snap[i] = h[i];
   ArraySort(snap);
   for(int i = 0; i < n1; i++)                       // substitute holiday
     {
      if(Dow(snap[i]) == 0)
        {
         datetime s = snap[i] + 86400;
         while(InList(h, s)) s += 86400;
         AddDate(h, s);
        }
     }
  }

bool JpBusinessDay(const datetime day)
  {
   int dw = Dow(day);
   if(dw == 0 || dw == 6) return false;
   MqlDateTime s; TimeToStruct(day, s);
   if((s.mon == 12 && s.day == 31) || (s.mon == 1 && s.day <= 3)) return false;
   if(InList(g_extra_hol, day)) return false;
   datetime h[];
   JpHolidays(s.year, h);
   return !InList(h, day);
  }

bool IsGotobi(const datetime day)
  {
   MqlDateTime s; TimeToStruct(day, s);
   for(int k = 0; k < 2; k++)                        // targets of this month and the next
     {
      int y = s.year, m = s.mon + k;
      if(m == 13) { m = 1; y++; }
      int targets[6] = {5, 10, 15, 20, 25, 0};
      targets[5] = DaysInMonth(y, m);
      for(int i = 0; i < 6; i++)
        {
         datetime d = MakeDate(y, m, targets[i]);
         while(!JpBusinessDay(d)) d -= 86400;
         if(d == day) return true;
        }
     }
   return false;
  }

//==================================================================== indicators (series order: index 1 = last closed bar)
double TrueRange(const MqlRates &r[], const int i)
  {
   double pc = r[i + 1].close;
   return MathMax(r[i].high - r[i].low, MathMax(MathAbs(r[i].high - pc), MathAbs(r[i].low - pc)));
  }

double AtrSma(const MqlRates &r[], const int shift, const int n)
  {
   double s = 0.0;
   for(int i = shift; i < shift + n; i++) s += TrueRange(r, i);
   return s / n;
  }

double Sma(const MqlRates &r[], const int shift, const int n)
  {
   double s = 0.0;
   for(int i = shift; i < shift + n; i++) s += r[i].close;
   return s / n;
  }

double StdPop(const MqlRates &r[], const int shift, const int n)
  {
   double m = Sma(r, shift, n), v = 0.0;
   for(int i = shift; i < shift + n; i++) v += (r[i].close - m) * (r[i].close - m);
   return MathSqrt(v / n);
  }

double Ema(const MqlRates &r[], const int shift, const int n, const int total)
  {
   double a = 2.0 / (n + 1.0);
   double e = r[total - 1].close;
   for(int i = total - 2; i >= shift; i--) e = a * r[i].close + (1.0 - a) * e;
   return e;
  }

double AdxWilder(const MqlRates &r[], const int shift, const int n, const int total)
  {
   double tr_s = 0, p_s = 0, n_s = 0, adx = 0, dx_sum = 0;
   int cnt = 0, dx_cnt = 0;
   bool ready = false;
   for(int i = total - 2; i >= shift; i--)
     {
      double up = r[i].high - r[i + 1].high;
      double dn = r[i + 1].low - r[i].low;
      double pdm = (up > dn && up > 0) ? up : 0.0;
      double ndm = (dn > up && dn > 0) ? dn : 0.0;
      double tr = TrueRange(r, i);
      cnt++;
      if(cnt <= n)
        {
         tr_s += tr; p_s += pdm; n_s += ndm;
         if(cnt < n) continue;
         tr_s /= n; p_s /= n; n_s /= n;
        }
      else
        {
         tr_s = (tr_s * (n - 1) + tr) / n;
         p_s = (p_s * (n - 1) + pdm) / n;
         n_s = (n_s * (n - 1) + ndm) / n;
        }
      double pdi = tr_s > 0 ? 100.0 * p_s / tr_s : 0.0;
      double ndi = tr_s > 0 ? 100.0 * n_s / tr_s : 0.0;
      double dx = (pdi + ndi) > 0 ? 100.0 * MathAbs(pdi - ndi) / (pdi + ndi) : 0.0;
      if(!ready) { dx_sum += dx; dx_cnt++; if(dx_cnt == n) { adx = dx_sum / n; ready = true; } }
      else adx = (adx * (n - 1) + dx) / n;
     }
   return ready ? adx : 100.0;
  }

double RealizedVol(const MqlRates &r[], const int shift, const int n)
  {
   double s = 0, s2 = 0;
   for(int i = shift; i < shift + n; i++) { double x = MathLog(r[i].close / r[i + 1].close); s += x; s2 += x * x; }
   double mean = s / n;
   return MathSqrt(MathMax((s2 - n * mean * mean) / (n - 1), 0.0));
  }

//==================================================================== account / risk
void ParseStages()
  {
   ArrayResize(g_stage_bal, 0); ArrayResize(g_stage_mult, 0);
   string parts[];
   int n = StringSplit(InpStages, ';', parts);
   for(int i = 0; i < n; i++)
     {
      string kv[];
      if(StringSplit(parts[i], ':', kv) != 2) continue;
      int k = ArraySize(g_stage_bal);
      ArrayResize(g_stage_bal, k + 1); ArrayResize(g_stage_mult, k + 1);
      g_stage_bal[k] = StringToDouble(kv[0]); g_stage_mult[k] = StringToDouble(kv[1]);
     }
   for(int i = 0; i < ArraySize(g_stage_bal); i++)
      for(int j = i + 1; j < ArraySize(g_stage_bal); j++)
         if(g_stage_bal[j] < g_stage_bal[i])
           {
            double tb = g_stage_bal[i]; g_stage_bal[i] = g_stage_bal[j]; g_stage_bal[j] = tb;
            double tm = g_stage_mult[i]; g_stage_mult[i] = g_stage_mult[j]; g_stage_mult[j] = tm;
           }
  }

double StageMult(const double balance)
  {
   double m = 1.0;
   for(int i = 0; i < ArraySize(g_stage_bal); i++) if(balance >= g_stage_bal[i]) m = g_stage_mult[i];
   return m;
  }

double LossPerLot(const string sym, const double dist)
  {
   double ts = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   double tv = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tv <= 0) tv = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
   if(ts <= 0 || tv <= 0) return 0.0;
   return dist / ts * tv;
  }

bool IsOurMagic(const long mg) { return mg >= InpMagicBase + 1 && mg <= InpMagicBase + 3; }

int CountOurPositions()
  {
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t != 0 && PositionSelectByTicket(t) && IsOurMagic(PositionGetInteger(POSITION_MAGIC))) n++;
     }
   return n;
  }

ulong FindPosition(const string sym, const long magic)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !PositionSelectByTicket(t)) continue;
      if(PositionGetInteger(POSITION_MAGIC) == magic && PositionGetString(POSITION_SYMBOL) == sym) return t;
     }
   return 0;
  }

// initial JPY risk stored in the comment ("... r=<jpy>"), for all our positions or one magic
double OpenRiskJpy(const long only_magic = 0)
  {
   double total = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !PositionSelectByTicket(t)) continue;
      long mg = PositionGetInteger(POSITION_MAGIC);
      if(!IsOurMagic(mg) || (only_magic != 0 && mg != only_magic)) continue;
      string c = PositionGetString(POSITION_COMMENT);
      int p = StringFind(c, "r=");
      if(p >= 0) total += StringToDouble(StringSubstr(c, p + 2));
      else
        {
         string sym = PositionGetString(POSITION_SYMBOL);
         total += LossPerLot(sym, MathAbs(PositionGetDouble(POSITION_PRICE_OPEN) - PositionGetDouble(POSITION_SL)))
                  * PositionGetDouble(POSITION_VOLUME);
        }
     }
   return total;
  }

bool EntryAllowed(const string sym, const double max_spread_pips)
  {
   if(GvGet(g_gv_halt, 0.0) > 0.0) return false;
   if(CountOurPositions() >= InpMaxPositions) { Log("SKIP", sym, "max positions"); return false; }
   double daybal = GvGet(g_gv_daybal, AccountInfoDouble(ACCOUNT_BALANCE));
   if(AccountInfoDouble(ACCOUNT_EQUITY) < daybal * (1.0 - InpDailyLossPct / 100.0)) { Log("SKIP", sym, "daily loss limit"); return false; }
   double sp = SpreadPips(sym);
   if(sp > max_spread_pips) { Log("SKIP", sym, StringFormat("spread %.2f pips > %.2f", sp, max_spread_pips)); return false; }
   return true;
  }

// lots for a stop distance (same budget rule as fxlab.engine.run_portfolio); reason set when 0
double LotsFor(const string sym, const double stop_dist, const double book_risk_pct, const long magic,
               const double book_cap_pct, double &risk_jpy, string &reason)
  {
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double peak = GvGet(g_gv_balpeak, bal);
   double throttle = (peak > 0 && 100.0 * (1.0 - bal / peak) >= InpThrottleDDPct) ? InpThrottleMult : 1.0;
   double rf = book_risk_pct / 100.0 * StageMult(bal) * throttle;
   double want = bal * rf;
   double budget = MathMin(want, bal * InpMaxOpenRiskPct / 100.0 - OpenRiskJpy());
   if(book_cap_pct > 0) budget = MathMin(budget, bal * book_cap_pct / 100.0 - OpenRiskJpy(magic));
   risk_jpy = 0.0;
   reason = "";
   if(budget <= 0) { reason = "risk_cap"; return 0.0; }
   double spread = SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID);
   double per_lot = LossPerLot(sym, stop_dist + spread);
   if(per_lot <= 0) { reason = "no_tick_value"; return 0.0; }
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   double lots = MathFloor(budget / per_lot / step + 1e-9) * step;
   double price = SymbolInfoDouble(sym, SYMBOL_ASK), margin = 0.0;
   if(lots >= vmin && OrderCalcMargin(ORDER_TYPE_BUY, sym, lots, price, margin) && margin > 0)
     {
      double cap = AccountInfoDouble(ACCOUNT_EQUITY) * InpMarginUsePct / 100.0 - AccountInfoDouble(ACCOUNT_MARGIN);
      if(margin > cap) lots = MathFloor(lots * MathMax(cap, 0.0) / margin / step + 1e-9) * step;
     }
   if(lots < vmin - 1e-12) { reason = budget < want ? "risk_cap" : "below_min_lot"; return 0.0; }   // never round up
   lots = MathMin(lots, vmax);
   risk_jpy = lots * per_lot;
   return lots;
  }

bool OpenMarket(const string sym, const int dir, const double stop_dist, const double book_risk_pct,
                const long magic, const string tag, const double max_spread, const double book_cap_pct)
  {
   if(!EntryAllowed(sym, max_spread)) return false;
   double risk_jpy = 0.0;
   string reason;
   double lots = LotsFor(sym, stop_dist, book_risk_pct, magic, book_cap_pct, risk_jpy, reason);
   if(lots <= 0) { Log("SKIP", sym, tag + " " + reason); return false; }
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double bid = SymbolInfoDouble(sym, SYMBOL_BID), ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   double px = dir > 0 ? ask : bid;
   double sl = NormalizeDouble(px - dir * stop_dist, digits);
   string cmt = StringFormat("%s r=%.0f", tag, risk_jpy);
   g_trade.SetExpertMagicNumber(magic);
   g_trade.SetTypeFillingBySymbol(sym);
   bool ok = dir > 0 ? g_trade.Buy(lots, sym, 0.0, sl, 0.0, cmt) : g_trade.Sell(lots, sym, 0.0, sl, 0.0, cmt);
   string fill = "";
   ulong deal = g_trade.ResultDeal();
   if(ok && deal > 0 && HistoryDealSelect(deal))
      fill = StringFormat(" fill=%s fill_ms=%I64d", DoubleToString(HistoryDealGetDouble(deal, DEAL_PRICE), digits),
                          HistoryDealGetInteger(deal, DEAL_TIME_MSC));
   Log(ok ? "OPEN" : "ERR_OPEN", sym, StringFormat("%s dir=%d lots=%.2f bid=%s ask=%s sl=%s risk=%.0f rc=%d%s", tag, dir, lots,
       DoubleToString(bid, digits), DoubleToString(ask, digits), DoubleToString(sl, digits), risk_jpy,
       (int)g_trade.ResultRetcode(), fill));
   return ok;
  }

bool ClosePos(const ulong ticket, const string sym, const string why)
  {
   g_trade.SetTypeFillingBySymbol(sym);
   bool ok = g_trade.PositionClose(ticket, InpDeviationPts);
   Log(ok ? "CLOSE" : "ERR_CLOSE", sym, why + StringFormat(" rc=%d", (int)g_trade.ResultRetcode()));
   return ok;
  }

void CloseAll(const string why)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !PositionSelectByTicket(t) || !IsOurMagic(PositionGetInteger(POSITION_MAGIC))) continue;
      ClosePos(t, PositionGetString(POSITION_SYMBOL), why);
     }
  }

void UpdateAccountState()
  {
   double bal = AccountInfoDouble(ACCOUNT_BALANCE), eq = AccountInfoDouble(ACCOUNT_EQUITY);
   double bpeak = GvGet(g_gv_balpeak, bal);
   if(bal > bpeak) GlobalVariableSet(g_gv_balpeak, bal);
   double epeak = GvGet(g_gv_eqpeak, eq);
   if(eq > epeak) { epeak = eq; GlobalVariableSet(g_gv_eqpeak, eq); }
   MqlDateTime t; TimeToStruct(Now(), t);
   double today = t.year * 10000.0 + t.mon * 100.0 + t.day;
   if(GvGet(g_gv_day, 0.0) != today) { GlobalVariableSet(g_gv_day, today); GlobalVariableSet(g_gv_daybal, eq); }
   if(GvGet(g_gv_halt, 0.0) == 0.0 && eq < epeak * (1.0 - InpHaltDDPct / 100.0))
     {
      GlobalVariableSet(g_gv_halt, 1.0);
      CloseAll("HALT equity drawdown limit");
      Alert("TitanPortfolioEA halted (equity drawdown limit). Review, then delete global variable ", g_gv_halt, " to resume.");
     }
  }

// deposits / withdrawals must not look like trading gains / drawdowns
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD || trans.deal == 0) return;
   if(!HistoryDealSelect(trans.deal)) return;
   ENUM_DEAL_TYPE dt = (ENUM_DEAL_TYPE)HistoryDealGetInteger(trans.deal, DEAL_TYPE);
   if(dt != DEAL_TYPE_BALANCE && dt != DEAL_TYPE_CREDIT) return;
   double amt = HistoryDealGetDouble(trans.deal, DEAL_PROFIT);
   if(amt == 0.0) return;
   string names[3]; names[0] = g_gv_balpeak; names[1] = g_gv_eqpeak; names[2] = g_gv_daybal;
   for(int i = 0; i < 3; i++)
      if(GlobalVariableCheck(names[i])) GlobalVariableSet(names[i], MathMax(GlobalVariableGet(names[i]) + amt, 1.0));
   Log("CASHFLOW", "", StringFormat("%.0f JPY (peaks and daily reference adjusted)", amt));
  }

//==================================================================== GOTOBI book
void ProcessGotobi()
  {
   if(!InpGotobiOn || g_gotobi_sym == "") return;
   string sym = g_gotobi_sym;
   datetime now = Now();
   bool clock_ok;
   datetime jst = ServerToJst(now, clock_ok);
   datetime jday = DayStart(jst);
   int jsec = (int)(jst - jday);

   // mechanism monitor: sell-direction mid move 09:55:00 -> 10:05:00 on every gotobi day
   if(g_mech_day != jday) { g_mech_day = jday; g_mech_mid0955 = 0.0; g_mech_done = false; }
   double mid = 0.5 * (SymbolInfoDouble(sym, SYMBOL_BID) + SymbolInfoDouble(sym, SYMBOL_ASK));
   if(!g_mech_done && jsec >= InpGotobiEntrySec && jsec < InpGotobiEntrySec + 600 && g_mech_mid0955 == 0.0 && IsGotobi(jday))
      g_mech_mid0955 = mid;
   if(!g_mech_done && g_mech_mid0955 > 0 && jsec >= InpGotobiEntrySec + 600)
     {
      g_mech_done = true;
      Log("GTB_MECH", sym, StringFormat("mid0955=%.3f mid1005=%.3f sell_move_pips=%.2f", g_mech_mid0955, mid,
          (g_mech_mid0955 - mid) / PipSize(sym)));
     }

   ulong tk = FindPosition(sym, MagicGotobi());
   if(tk != 0)
     {
      datetime opened = (datetime)PositionGetInteger(POSITION_TIME);
      bool dummy;
      bool other_day = DayStart(ServerToJst(opened, dummy)) != jday;
      if(jsec >= InpGotobiExitSec || other_day) ClosePos(tk, sym, "GTB 15:00 JST exit");
      return;
     }
   if(jsec < InpGotobiEntrySec || jsec >= InpGotobiEntrySec + InpGotobiWindowSec) return;
   double dayid = (double)jday;
   if(GvGet(g_gv_gotobi_day, 0.0) == dayid) return;               // one trade per JST day
   MqlDateTime js; TimeToStruct(jday, js);
   if(!IsGotobi(jday) || (InpGotobiSkipDec25 && js.mon == 12 && js.day == 25))
     { GlobalVariableSet(g_gv_gotobi_day, dayid); return; }
   if(!clock_ok) { GlobalVariableSet(g_gv_gotobi_day, dayid); return; }   // clock mismatch: skip the day
   MqlDateTime ss; TimeToStruct(now, ss);
   if(ss.hour < 1) return;                                          // never in the rollover hour
   MqlRates r[]; ArraySetAsSeries(r, true);
   if(CopyRates(sym, PERIOD_D1, 0, 20, r) < 17) return;
   double atr = AtrSma(r, 1, 14);
   if(atr <= 0) return;
   // retried every timer event inside the one-minute window (e.g. while the spread is too wide)
   if(OpenMarket(sym, -1, InpGotobiStopAtr * atr, InpGotobiRiskPct, MagicGotobi(), "GTB", InpGotobiMaxSpread, 0.0))
      GlobalVariableSet(g_gv_gotobi_day, dayid);
  }

//==================================================================== D1 books
bool NewD1Ready(D1State &st, datetime &bar0)
  {
   bar0 = iTime(st.sym, PERIOD_D1, 0);
   if(bar0 == 0 || bar0 == st.last_bar) return false;
   MqlDateTime s; TimeToStruct(Now(), s);
   return s.hour >= 1;                                               // decisions at/after 01:00 server
  }

void MarkDone(D1State &st, const datetime bar0)
  {
   st.last_bar = bar0;
   GlobalVariableSet(st.gv, (double)bar0);
  }

void ProcessMeanRev(D1State &st)
  {
   datetime bar0;
   if(!NewD1Ready(st, bar0)) return;
   string sym = st.sym;
   MqlRates r[]; ArraySetAsSeries(r, true);
   int total = CopyRates(sym, PERIOD_D1, 0, 1100, r);
   if(total < 1000) { Log("SKIP", sym, "MR needs >= 1000 D1 bars"); return; }
   MarkDone(st, bar0);
   double c1 = r[1].close, c2 = r[2].close;
   double m1 = Sma(r, 1, InpMrBbN), m2 = Sma(r, 2, InpMrBbN);
   double sd1 = StdPop(r, 1, InpMrBbN), sd2 = StdPop(r, 2, InpMrBbN);
   bool L = c2 < m2 - InpMrBbK * sd2 && c1 > m1 - InpMrBbK * sd1;
   bool S = c2 > m2 + InpMrBbK * sd2 && c1 < m1 + InpMrBbK * sd1;
   double atr = AtrSma(r, 1, InpMrAtrN), atr_slow = AtrSma(r, 1, InpMrVolN), atr20 = AtrSma(r, 1, 20);
   double adx = AdxWilder(r, 1, InpMrAdxN, total);
   double ema = Ema(r, 1, InpMrEmaN, total);
   bool regime = adx < InpMrAdxMax && atr_slow > 0 && atr / atr_slow < InpMrVolMax &&
                 atr20 > 0 && MathAbs(c1 - ema) / atr20 < InpMrFlatK;
   L = L && regime; S = S && regime;
   double mexit = Sma(r, 1, InpMrExitN);
   bool xl = c1 > mexit, xs = c1 < mexit;
   L = L && !xl; S = S && !xs;
   double stop = InpMrStopAtr * atr;
   ulong tk = FindPosition(sym, MagicMeanRev());
   if(tk != 0 && PositionSelectByTicket(tk))
     {
      int dir = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      int held = iBarShift(sym, PERIOD_D1, (datetime)PositionGetInteger(POSITION_TIME), false);
      bool rev = (dir > 0 && S) || (dir < 0 && L);
      bool ex = (dir > 0 && xl) || (dir < 0 && xs) || rev || (InpMrMaxHold > 0 && held >= InpMrMaxHold);
      if(!ex) return;
      if(!ClosePos(tk, sym, rev ? "MR reverse" : "MR exit")) return;
     }
   if(stop <= 0) return;
   if(L && !S) OpenMarket(sym, 1, stop, InpMeanRevRiskPct, MagicMeanRev(), "MR", InpMaxSpreadPips, 0.0);
   else if(S && !L) OpenMarket(sym, -1, stop, InpMeanRevRiskPct, MagicMeanRev(), "MR", InpMaxSpreadPips, 0.0);
  }

// rate of `ccy` for calendar `year` from InpRates; false if missing
bool YearRate(const string ccy, const int year, double &rate)
  {
   string rows[];
   int n = StringSplit(InpRates, ';', rows);
   for(int i = 0; i < n; i++)
     {
      string yr[];
      if(StringSplit(rows[i], ':', yr) != 2) continue;
      if((int)StringToInteger(yr[0]) != year) continue;
      string kv[];
      int m = StringSplit(yr[1], ',', kv);
      for(int j = 0; j < m; j++)
        {
         string p[];
         if(StringSplit(kv[j], '=', p) == 2)
           {
            StringTrimLeft(p[0]); StringTrimRight(p[0]);
            if(p[0] == ccy) { rate = StringToDouble(p[1]); return true; }
           }
        }
     }
   return false;
  }

// carry direction for decisions in `year` (uses year-1); ok=false when the row is missing
int CarryDir(const string sym, const int year, bool &ok)
  {
   double rb, rq;
   string base = StringSubstr(sym, 0, 3), quote = StringSubstr(sym, 3, 3);
   ok = YearRate(base, year - 1, rb) && YearRate(quote, year - 1, rq);
   if(!ok) return 0;
   double diff = rb - rq;
   if(diff >= InpCarryMinDiff) return 1;
   if(diff <= -InpCarryMinDiff) return -1;
   return 0;
  }

void ProcessCarry(D1State &st)
  {
   datetime bar0;
   if(!NewD1Ready(st, bar0)) return;
   string sym = st.sym;
   MqlRates r[]; ArraySetAsSeries(r, true);
   int total = CopyRates(sym, PERIOD_D1, 0, 700, r);
   if(total < InpCarryVolSlow + 60) { Log("SKIP", sym, "CARRY needs more D1 history"); return; }
   MarkDone(st, bar0);
   MqlDateTime s1; TimeToStruct(r[1].time, s1);
   MqlDateTime s2; TimeToStruct(r[2].time, s2);
   bool ok1, ok2;
   int cd = CarryDir(sym, s1.year, ok1);
   int cd_prev = CarryDir(sym, s2.year, ok2);
   if(!ok1)
     {
      double wday = (double)DayStart(Now());
      if(GvGet(g_gv_ratewarn, 0.0) != wday)
        {
         GlobalVariableSet(g_gv_ratewarn, wday);
         string msg = StringFormat("TitanPortfolioEA: InpRates has no row for %d - carry book flat until it is added", s1.year - 1);
         Alert(msg);
         SendNotification(msg);
        }
     }
   if(!ok2) cd_prev = cd;                                            // missing Y-2 row: no artificial year flip
   double c1 = r[1].close;
   double ema = Ema(r, 1, InpCarryEmaN, total);
   int trend = c1 > ema ? 1 : (c1 < ema ? -1 : 0);
   double vf = RealizedVol(r, 1, InpCarryVolFast), vs = RealizedVol(r, 1, InpCarryVolSlow);
   double vr = vs > 0 ? vf / vs : 99.0;
   double atr = AtrSma(r, 1, InpCarryAtrN);
   ulong tk = FindPosition(sym, MagicCarry());
   if(tk != 0 && PositionSelectByTicket(tk))
     {
      int dir = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      if(InpCarryTrailAtr > 0)
        {
         MqlRates h[];
         int n = CopyRates(sym, PERIOD_H1, (datetime)PositionGetInteger(POSITION_TIME), Now(), h);
         double hh = -DBL_MAX, ll = DBL_MAX;
         for(int i = 0; i < n; i++) { hh = MathMax(hh, h[i].high); ll = MathMin(ll, h[i].low); }
         double sl = PositionGetDouble(POSITION_SL);
         double ns = NormalizeDouble(dir > 0 ? hh - InpCarryTrailAtr * atr : ll + InpCarryTrailAtr * atr, digits);
         if(n > 0 && ((dir > 0 && ns > sl) || (dir < 0 && (sl == 0 || ns < sl))))
           {
            double bid = SymbolInfoDouble(sym, SYMBOL_BID), ask = SymbolInfoDouble(sym, SYMBOL_ASK);
            if((dir > 0 && bid <= ns) || (dir < 0 && ask >= ns))
              {
               if(!ClosePos(tk, sym, "CARRY trail beyond price")) return;
               tk = 0;
              }
            else
              {
               g_trade.SetExpertMagicNumber(MagicCarry());
               if(g_trade.PositionModify(tk, ns, 0.0)) Log("TRAIL", sym, DoubleToString(ns, digits));
              }
           }
        }
      if(tk != 0)
        {
         bool brk = dir > 0 ? trend <= 0 : trend >= 0;
         bool ex = brk || vr >= InpCarryVolExit || cd == 0 || cd != cd_prev || cd != dir;
         if(!ex) return;
         if(!ClosePos(tk, sym, "CARRY exit")) return;
        }
     }
   if(cd != 0 && trend == cd && vr < InpCarryVolEntry && atr > 0)
      OpenMarket(sym, cd, InpCarryStopAtr * atr, InpCarryRiskPct, MagicCarry(), "CRY", InpMaxSpreadPips, InpCarryBookCapPct);
  }

//==================================================================== init / events
void LoadSymbols(const string csv, D1State &arr[], const string book)
  {
   string parts[];
   int n = StringSplit(csv, ',', parts);
   ArrayResize(arr, 0);
   for(int i = 0; i < n; i++)
     {
      string s = parts[i];
      StringTrimLeft(s); StringTrimRight(s);
      if(s == "") continue;
      s += InpSymbolSuffix;
      if(!SymbolSelect(s, true)) { Print("symbol not available: ", s); continue; }
      int k = ArraySize(arr);
      ArrayResize(arr, k + 1);
      arr[k].sym = s;
      arr[k].gv = "TPEA_" + IntegerToString(InpMagicBase) + "_" + book + "_" + s;
      // resume from the last processed bar; on the very first start do not act on the open bar
      if(GlobalVariableCheck(arr[k].gv) && !g_tester) arr[k].last_bar = (datetime)GlobalVariableGet(arr[k].gv);
      else arr[k].last_bar = iTime(s, PERIOD_D1, 0);
     }
  }

void LoadExtraHolidays()
  {
   ArrayResize(g_extra_hol, 0);
   string parts[];
   int n = StringSplit(InpJpExtraHolidays, ';', parts);
   for(int i = 0; i < n; i++)
     {
      string s = parts[i];
      StringTrimLeft(s); StringTrimRight(s);
      if(s != "") AddDate(g_extra_hol, DayStart(StringToTime(s)));
     }
  }

bool ValidateRates()
  {
   string rows[];
   int n = StringSplit(InpRates, ';', rows);
   int years[];
   string ccys[6] = {"USD", "EUR", "JPY", "GBP", "AUD", "CAD"};
   for(int i = 0; i < n; i++)
     {
      string yr[];
      if(StringSplit(rows[i], ':', yr) != 2) { Print("InpRates: bad row '", rows[i], "'"); return false; }
      int y = (int)StringToInteger(yr[0]);
      for(int k = 0; k < ArraySize(years); k++) if(years[k] == y) { Print("InpRates: duplicate year ", y); return false; }
      int m = ArraySize(years); ArrayResize(years, m + 1); years[m] = y;
      for(int c = 0; c < 6; c++)
        {
         double v;
         if(!YearRate(ccys[c], y, v) || v < -1.0 || v > 20.0) { Print("InpRates: ", y, " ", ccys[c], " missing or out of range"); return false; }
        }
     }
   return true;
  }

int OnInit()
  {
   g_tester = (bool)MQLInfoInteger(MQL_TESTER);
   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
     {
      Print("TitanPortfolioEA requires a HEDGING account (books may hold opposite positions on one symbol).");
      return INIT_FAILED;
     }
   if(InpCarryOn && !ValidateRates()) return INIT_PARAMETERS_INCORRECT;
   g_trade.SetDeviationInPoints(InpDeviationPts);
   g_trade.SetMarginMode();
   string p = "TPEA_" + IntegerToString(InpMagicBase) + "_";
   g_gv_balpeak = p + "balpeak"; g_gv_eqpeak = p + "eqpeak"; g_gv_halt = p + "halt"; g_gv_day = p + "day";
   g_gv_daybal = p + "daybal"; g_gv_gotobi_day = p + "gotobi_day"; g_gv_ratewarn = p + "ratewarn";
   if(g_tester)
     {
      string names[7] = {g_gv_balpeak, g_gv_eqpeak, g_gv_halt, g_gv_day, g_gv_daybal, g_gv_gotobi_day, g_gv_ratewarn};
      for(int i = 0; i < 7; i++) GlobalVariableDel(names[i]);
     }
   ParseStages();
   LoadExtraHolidays();
   if(AccountInfoString(ACCOUNT_CURRENCY) != "JPY")
      Print("warning: account currency is ", AccountInfoString(ACCOUNT_CURRENCY), " - risk is still % of balance");
   if(InpGotobiOn)
     {
      g_gotobi_sym = InpGotobiSymbol + InpSymbolSuffix;
      if(!SymbolSelect(g_gotobi_sym, true)) { Print("gotobi symbol not available: ", g_gotobi_sym); g_gotobi_sym = ""; }
     }
   if(InpMeanRevOn) LoadSymbols(InpMrSymbols, g_mr, "mr");
   if(InpCarryOn) LoadSymbols(InpCarrySymbols, g_carry, "carry");
   if(InpLogCsv)
     {
      g_csv = FileOpen("TitanPortfolioEA_" + IntegerToString(InpMagicBase) + (g_tester ? "_tester" : "") + ".csv",
                       FILE_WRITE | FILE_READ | FILE_CSV | FILE_ANSI | FILE_SHARE_READ, ',');
      if(g_csv != INVALID_HANDLE) FileSeek(g_csv, 0, SEEK_END);
     }
   datetime now = Now();
   bool ok;
   datetime jst = ServerToJst(now, ok);
   Log("INIT", "", StringFormat("v1.10 server=%s rule=GMT+%d live=GMT+%d jst=%s gotobi_today=%d balance=%.0f books=%s%s%s",
       TimeToString(now), RuleOffset(now), LiveOffset(), TimeToString(jst), (int)IsGotobi(DayStart(jst)),
       AccountInfoDouble(ACCOUNT_BALANCE), InpGotobiOn ? "G" : "", InpMeanRevOn ? "M" : "", InpCarryOn ? "C" : ""));
   EventSetMillisecondTimer(250);
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
   ProcessGotobi();
   for(int i = 0; i < ArraySize(g_mr); i++) ProcessMeanRev(g_mr[i]);
   for(int i = 0; i < ArraySize(g_carry); i++) ProcessCarry(g_carry[i]);
  }

void OnTick() { }
//+------------------------------------------------------------------+
