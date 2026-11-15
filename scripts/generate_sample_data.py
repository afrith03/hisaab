"""Generate Meena Provision Store's October 2026 sample data.

Transactions are shaped like Paytm transaction/settlement records so the
data source can later be swapped for the Paytm MCP Server without touching
the agent or the GST rules. Run: python3 scripts/generate_sample_data.py
"""
import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path

import os
random.seed(int(os.environ.get("SEED", "777")))
BULK_SHARE = float(os.environ.get("BULK_SHARE", "0.30"))
BULK_MAX = int(os.environ.get("BULK_MAX", "60000"))
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data"
IMG = ROOT / "public" / "bills"
OUT.mkdir(parents=True, exist_ok=True)
IMG.mkdir(parents=True, exist_ok=True)

MERCHANT = {
    "mid": "MEENAP00000000000001",
    "name": "Meena Provision Store",
    "owner": "Meena",
    "city": "Chennai",
    "gstin": "33ABCPM1234F1Z5",
    "language": "ta-IN",
    "gstType": "regular",
    # Share of business receipts by GST slab (GST-inclusive prices). Configurable per merchant.
    "salesSlabMix": {"0": 0.35, "5": 0.50, "18": 0.15},
}

FIRST = ["Arun", "Priya", "Karthik", "Divya", "Suresh", "Lakshmi", "Vijay", "Kavya", "Ramesh", "Anitha",
         "Senthil", "Deepa", "Mohan", "Revathi", "Ganesh", "Sangeetha", "Bala", "Nithya", "Prakash", "Meera"]
LAST = ["K", "S", "R", "M", "P", "V", "N", "T"]
BULK = ["Hotel Arusuvai Mess", "Amudham Tiffin Centre", "Kannan Tea Stall", "Sri Velan Catering", "Malar Bakery", "Thendral Hostel Mess"]


def mdr_for(amount: float) -> float:
    """0.4% MDR on P2M UPI above Rs 2,000, capped at Rs 300 (NPCI framework from 15 Oct 2026)."""
    if amount <= 2000:
        return 0.0
    return round(min(amount * 0.004, 300.0), 2)


txns = []
n = 0
start = date(2026, 10, 1)
for d in range(31):
    day = start + timedelta(days=d)
    for _ in range(random.randint(6, 8)):
        n += 1
        bulk = random.random() < BULK_SHARE
        if bulk:
            amount = float(random.randrange(4000, BULK_MAX, 50))
            payer = random.choice(BULK)
        else:
            amount = float(random.randrange(40, 1900, 10))
            payer = f"{random.choice(FIRST)} {random.choice(LAST)}"
        t = datetime(day.year, day.month, day.day, random.randint(7, 21), random.randint(0, 59))
        mdr = mdr_for(amount) if day >= date(2026, 10, 15) else 0.0
        gst = round(mdr * 0.18, 2)
        txns.append({
            "txnId": f"T{20261000000 + n}",
            "orderId": f"ORD{n:05d}",
            "txnDate": t.isoformat(),
            "txnAmount": amount,
            "paymentMode": "UPI",
            "flow": "P2M",
            "payerName": payer,
            "payerVpa": payer.lower().replace(" ", ".") + "@ptyes",
            "status": "TXN_SUCCESS",
            "mdr": mdr,
            "gstOnMdr": gst,
            "settledAmount": round(amount - mdr - gst, 2),
            "settlementDate": (day + timedelta(days=1)).isoformat(),
        })

# Two transfers a bookkeeper can't classify on their own.
unclear = [
    ("2026-10-12T19:40:00", 5000.0, "Ravi Kumar", "ravi.kumar@okaxis"),
    ("2026-10-24T11:05:00", 8000.0, "Karthik Subramanian", "karthik.s@oksbi"),
]
for i, (ts, amt, name, vpa) in enumerate(unclear):
    n += 1
    txns.append({
        "txnId": f"T{20261000000 + n}", "orderId": f"ORD{n:05d}", "txnDate": ts, "txnAmount": amt,
        "paymentMode": "UPI", "flow": "P2P", "payerName": name, "payerVpa": vpa, "status": "TXN_SUCCESS",
        "mdr": 0.0, "gstOnMdr": 0.0, "settledAmount": amt, "settlementDate": ts[:10],
    })
# One payment Meena made from her Paytm UPI: was it for the shop or personal?
n += 1
txns.append({
    "txnId": f"T{20261000000 + n}", "orderId": f"ORD{n:05d}", "txnDate": "2026-10-18T16:20:00", "txnAmount": 12000.0,
    "paymentMode": "UPI", "flow": "P2P", "direction": "OUT", "payerName": "Selvam R", "payerVpa": "selvam.r@okicici",
    "status": "TXN_SUCCESS", "mdr": 0.0, "gstOnMdr": 0.0, "settledAmount": -12000.0, "settlementDate": "2026-10-18",
})
txns.sort(key=lambda t: t["txnDate"])

bills = [
    {"id": "bill-1", "image": "/bills/bill-1.png", "supplier": "Kaveri Rice & Pulses Mandi",
     "supplierGstin": "33AAKFK4821M1Z2", "invoiceNo": "KRP/2026/1184", "invoiceDate": "2026-10-04",
     "items": [["Ponni Rice 25kg", "1006", 40, 1550.0, 5], ["Toor Dal 1kg", "0713", 200, 155.0, 5],
               ["Sugar 1kg", "1701", 250, 44.0, 5]]},
    {"id": "bill-2", "image": "/bills/bill-2.png", "supplier": "Velu FMCG Agencies",
     "supplierGstin": "33AADCV7310K1Z9", "invoiceNo": "VFA-88213", "invoiceDate": "2026-10-11",
     "items": [["Bath Soap (pack of 4)", "3401", 150, 180.0, 18], ["Detergent Powder 1kg", "3402", 150, 120.0, 18],
               ["Biscuits (carton)", "1905", 40, 420.0, 18]]},
    {"id": "bill-3", "image": "/bills/bill-3.png", "handwritten": True, "supplier": "Annai Oil Traders",
     "supplierGstin": "33AAEFA2290P1ZC", "invoiceNo": "AOT/OCT/0417", "invoiceDate": "2026-10-19",
     "items": [["Groundnut Oil 1L", "1508", 200, 185.0, 5], ["Gingelly Oil 1L", "1515", 60, 260.0, 5]]},
]
for b in bills:
    lines = []
    for name, hsn, qty, rate, gst in b["items"]:
        taxable = round(qty * rate, 2)
        half = round(taxable * gst / 100 / 2, 2)
        lines.append({"description": name, "hsn": hsn, "qty": qty, "rate": rate, "gstRate": gst,
                      "taxable": taxable, "cgst": half, "sgst": half})
    b["lines"] = lines
    b["taxable"] = round(sum(l["taxable"] for l in lines), 2)
    b["cgst"] = round(sum(l["cgst"] for l in lines), 2)
    b["sgst"] = round(sum(l["sgst"] for l in lines), 2)
    b["igst"] = 0.0
    b["total"] = round(b["taxable"] + b["cgst"] + b["sgst"], 2)
    del b["items"]

(OUT / "merchant.json").write_text(json.dumps(MERCHANT, indent=2))
(OUT / "october-2026-transactions.json").write_text(json.dumps(txns, indent=2))
(OUT / "bills.json").write_text(json.dumps(bills, indent=2))

# Render the bills as photo-like invoice images.
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def font(size, bold=False):
    p = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    return ImageFont.truetype(p, size)

FONTS = Path(__file__).resolve().parent / "fonts"

def hand(size, bold=False):
    return ImageFont.truetype(str(FONTS / ("kalam-latin-700-normal.woff" if bold else "kalam-latin-400-normal.woff")), size)

def render_handwritten(b):
    """A pre-printed bill book page filled in by hand in blue ink: how most local wholesalers bill."""
    rnd = random.Random(42)
    W, H = 900, 1180
    paper, maroon, ink = (247, 241, 214), (128, 28, 40), (24, 46, 140)
    im = Image.new("RGB", (W, H), paper)
    dr = ImageDraw.Draw(im)
    jit = lambda: rnd.randint(-3, 3)
    # Printed letterhead (maroon, as on a bill book)
    dr.rectangle([28, 28, W - 28, H - 28], outline=maroon, width=3)
    dr.text((W // 2, 62), "|| Sri Annai Thunai ||", font=font(16), fill=maroon, anchor="mm")
    dr.text((W // 2, 105), b["supplier"].upper(), font=font(36, True), fill=maroon, anchor="mm")
    dr.text((W // 2, 145), "Wholesale dealers in Groundnut & Gingelly Oil", font=font(17), fill=maroon, anchor="mm")
    dr.text((W // 2, 172), "45, Oil Mongers Street, Chennai - 600001  ·  Ph: 98410 XXXXX", font=font(16), fill=maroon, anchor="mm")
    dr.text((W // 2, 200), f"GSTIN : {b['supplierGstin']}", font=font(19, True), fill=maroon, anchor="mm")
    dr.line([40, 222, W - 40, 222], fill=maroon, width=2)
    dr.rectangle([W // 2 - 95, 234, W // 2 + 95, 266], outline=maroon, width=2)
    dr.text((W // 2, 250), "TAX INVOICE", font=font(18, True), fill=maroon, anchor="mm")
    # Pre-printed fields, filled by hand
    dr.text((50, 290), "No.", font=font(18), fill=maroon)
    dr.text((95, 278 + jit()), b["invoiceNo"].split("/")[-1], font=hand(34, True), fill=(170, 20, 30))  # red serial
    dr.text((600, 290), "Date :", font=font(18), fill=maroon)
    dr.line([665, 314, 850, 314], fill=maroon, width=1)
    dr.text((672, 280 + jit()), datetime.fromisoformat(b["invoiceDate"]).strftime("%d/%m/%y"), font=hand(32), fill=ink)
    dr.text((50, 342), "M/s.", font=font(18), fill=maroon)
    dr.line([100, 366, 850, 366], fill=maroon, width=1)
    dr.text((112, 330 + jit()), "Meena Provision Store, Chennai", font=hand(32), fill=ink)
    dr.text((50, 392), "Party GSTIN :", font=font(18), fill=maroon)
    dr.line([180, 416, 600, 416], fill=maroon, width=1)
    dr.text((190, 380 + jit()), MERCHANT["gstin"], font=hand(30), fill=ink)
    # Ruled table
    top, bot = 440, 800
    cols = [40, 90, 420, 530, 620, 720, W - 40]
    dr.rectangle([40, top, W - 40, bot], outline=maroon, width=2)
    dr.line([40, top + 40, W - 40, top + 40], fill=maroon, width=2)
    for x in cols[1:-1]:
        dr.line([x, top, x, bot], fill=maroon, width=1)
    for x0, x1, h in zip(cols, cols[1:], ["S.No", "Particulars", "HSN", "Qty", "Rate", "Amount"]):
        dr.text(((x0 + x1) // 2, top + 20), h, font=font(16, True), fill=maroon, anchor="mm")
    y = top + 58
    for i, l in enumerate(b["lines"], 1):
        cells = [str(i), l["description"].replace(" 1L", " (1 Ltr tin)"), l["hsn"], str(l["qty"]), f"{l['rate']:.0f}", f"{l['taxable']:,.0f}"]
        for (x0, x1), v in zip(zip(cols, cols[1:]), cells):
            dr.text((x0 + 8 + jit(), y + jit()), v, font=hand(30), fill=ink)
        y += 62
    # Hand-written totals
    ty = bot + 18
    rows = [("Total", f"{b['taxable']:,.0f}"), ("CGST 2.5%", f"{b['cgst']:,.0f}"), ("SGST 2.5%", f"{b['sgst']:,.0f}"), ("Grand Total", f"{b['total']:,.0f}/-")]
    for label, val in rows:
        bold = label == "Grand Total"
        dr.text((480, ty + jit()), label, font=hand(30, bold), fill=ink)
        dr.text((710, ty + jit()), val, font=hand(30, bold), fill=ink)
        ty += 46
    dr.line([700, ty - 50, 860, ty - 50], fill=ink, width=2)
    dr.text((50, bot + 30), "Rupees Fifty Five Thousand", font=hand(26), fill=ink)
    dr.text((50, bot + 64), "Two Hundred Thirty only", font=hand(26), fill=ink)
    # Signature scribble + printed footer
    pts = [(640 + k * 9, H - 135 + int(10 * __import__("math").sin(k / 1.7)) + rnd.randint(-4, 4)) for k in range(22)]
    dr.line(pts, fill=ink, width=3)
    dr.text((W - 60, H - 80), f"For {b['supplier'].upper()}", font=font(15, True), fill=maroon, anchor="rm")
    dr.text((60, H - 80), "E. & O.E.   Goods once sold cannot be taken back.", font=font(14), fill=maroon)
    im = im.rotate(rnd.uniform(-2.2, -1.2), expand=True, fillcolor=(190, 182, 168), resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.7))
    im.save(IMG / f"{b['id']}.png", optimize=True)

for b in bills:
    if b.get("handwritten"):
        render_handwritten(b)
        continue
    W, H = 900, 1180
    im = Image.new("RGB", (W, H), (250, 248, 240))
    dr = ImageDraw.Draw(im)
    dr.rectangle([30, 30, W - 30, H - 30], outline=(60, 60, 60), width=2)
    dr.text((60, 60), b["supplier"].upper(), font=font(30, True), fill=(20, 20, 20))
    dr.text((60, 105), "No. 12, Kothawal Chavadi Market, Chennai - 600001", font=font(18), fill=(60, 60, 60))
    dr.text((60, 135), f"GSTIN: {b['supplierGstin']}   State: Tamil Nadu (33)", font=font(18, True), fill=(30, 30, 30))
    dr.text((W // 2 - 90, 185), "TAX INVOICE", font=font(28, True), fill=(20, 20, 20))
    dr.text((60, 240), f"Invoice No: {b['invoiceNo']}", font=font(19), fill=(30, 30, 30))
    dr.text((560, 240), f"Date: {datetime.fromisoformat(b['invoiceDate']).strftime('%d-%m-%Y')}", font=font(19), fill=(30, 30, 30))
    dr.text((60, 275), f"Bill To: {MERCHANT['name']}, Chennai", font=font(19), fill=(30, 30, 30))
    dr.text((60, 305), f"Buyer GSTIN: {MERCHANT['gstin']}", font=font(19), fill=(30, 30, 30))
    y = 360
    dr.line([50, y, W - 50, y], fill=(60, 60, 60), width=2)
    cols = [60, 380, 470, 560, 660, 760]
    for x, h in zip(cols, ["Description", "HSN", "Qty", "Rate", "GST%", "Amount"]):
        dr.text((x, y + 10), h, font=font(18, True), fill=(20, 20, 20))
    y += 45
    dr.line([50, y, W - 50, y], fill=(60, 60, 60), width=1)
    for l in b["lines"]:
        y += 15
        vals = [l["description"], l["hsn"], str(l["qty"]), f"{l['rate']:.2f}", f"{l['gstRate']}%", f"{l['taxable']:,.2f}"]
        for x, v in zip(cols, vals):
            dr.text((x, y), v, font=font(17), fill=(30, 30, 30))
        y += 30
    y += 30
    dr.line([50, y, W - 50, y], fill=(60, 60, 60), width=1)
    for label, val in [("Taxable Value", b["taxable"]), ("CGST", b["cgst"]), ("SGST", b["sgst"]), ("GRAND TOTAL", b["total"])]:
        y += 40
        bold = label == "GRAND TOTAL"
        dr.text((480, y), label, font=font(20, bold), fill=(20, 20, 20))
        dr.text((700, y), f"Rs {val:,.2f}", font=font(20, bold), fill=(20, 20, 20))
    dr.text((60, H - 120), "Thank you for your business", font=font(17), fill=(80, 80, 80))
    dr.text((W - 330, H - 120), "Authorised Signatory", font=font(17), fill=(80, 80, 80))
    im = im.rotate(random.uniform(-1.5, 1.5), expand=True, fillcolor=(205, 200, 190)).filter(ImageFilter.GaussianBlur(0.6))
    im.save(IMG / f"{b['id']}.png", optimize=True)

biz = [t for t in txns if t["flow"] == "P2M"]
print(len(txns), "txns;", sum(1 for t in biz if t["mdr"] > 0), "with MDR; MDR", round(sum(t["mdr"] for t in biz), 2),
      "GST on MDR", round(sum(t["gstOnMdr"] for t in biz), 2), "; receipts", round(sum(t["txnAmount"] for t in biz), 2))
print("bills taxable", [b["taxable"] for b in bills], "ITC", round(sum(b["cgst"] + b["sgst"] for b in bills), 2))
