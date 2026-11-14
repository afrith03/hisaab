"""Generate Meena Provision Store's October 2026 sample data.

Transactions are shaped like Paytm transaction/settlement records so the
data source can later be swapped for the Paytm MCP Server without touching
the agent or the GST rules. Run: python3 scripts/generate_sample_data.py
"""
import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path

random.seed(15112026)
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
    # Share of business receipts by GST slab (GST-inclusive prices). Configurable per merchant.
    "salesSlabMix": {"0": 0.35, "5": 0.50, "18": 0.15},
}

FIRST = ["Arun", "Priya", "Karthik", "Divya", "Suresh", "Lakshmi", "Vijay", "Kavya", "Ramesh", "Anitha",
         "Senthil", "Deepa", "Mohan", "Revathi", "Ganesh", "Sangeetha", "Bala", "Nithya", "Prakash", "Meera"]
LAST = ["K", "S", "R", "M", "P", "V", "N", "T"]
BULK = ["Hotel Saravana Mess", "Annapoorna Tiffin Centre", "Kumar Tea Stall", "Sri Balaji Catering"]


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
        bulk = random.random() < 0.14
        if bulk:
            amount = float(random.randrange(2100, 15000, 50))
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
txns.sort(key=lambda t: t["txnDate"])

bills = [
    {"id": "bill-1", "image": "/bills/bill-1.png", "supplier": "Sri Murugan Wholesale Traders",
     "supplierGstin": "33AAKFS4821M1Z2", "invoiceNo": "SMW/2026/1184", "invoiceDate": "2026-10-04",
     "items": [["Ponni Rice 25kg", "1006", 12, 1550.0, 5], ["Toor Dal 1kg", "0713", 60, 155.0, 5],
               ["Sugar 1kg", "1701", 80, 44.0, 5]]},
    {"id": "bill-2", "image": "/bills/bill-2.png", "supplier": "Chennai FMCG Distributors",
     "supplierGstin": "33AADCC7310K1Z9", "invoiceNo": "CFD-88213", "invoiceDate": "2026-10-11",
     "items": [["Bath Soap (pack of 4)", "3401", 60, 180.0, 18], ["Detergent Powder 1kg", "3402", 50, 120.0, 18],
               ["Biscuits (carton)", "1905", 12, 420.0, 18]]},
    {"id": "bill-3", "image": "/bills/bill-3.png", "supplier": "Lakshmi Oil Mills",
     "supplierGstin": "33AAEFL2290P1ZC", "invoiceNo": "LOM/OCT/0417", "invoiceDate": "2026-10-19",
     "items": [["Groundnut Oil 1L", "1508", 60, 185.0, 5], ["Gingelly Oil 1L", "1515", 20, 260.0, 5]]},
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

for b in bills:
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
