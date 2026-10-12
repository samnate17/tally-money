# Statement PDFs where every line is ONE text run (typical of bank statement engines) and the minus sign is U+2212.
# python3 test/fixtures/make-singlerun.py   (needs reportlab; the PDFs are committed)
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
import os
here = os.path.dirname(os.path.abspath(__file__))

def make(name, lines):
    c = canvas.Canvas(os.path.join(here, name), pagesize=letter)
    y = 740
    for size, text in lines:
        c.setFont('Helvetica', size)
        c.drawString(48, y, text)
        y -= size + 8
    c.save()

M = '−'
make('singlerun-checking.pdf', [
    (14, 'FIRST NATIONAL BANK - Checking Statement'),
    (10, 'Statement Period 10/01/2026 - 10/31/2026'),
    (10, 'Account ending 4412   Member FDIC'),
    (10, 'Beginning Balance $1,000.00'),
    (10, 'DATE DESCRIPTION AMOUNT BALANCE'),
    (10, f'10/02 DEBIT CARD PURCHASE STARBUCKS #4412 {M}6.75 993.25'),
    (10, '10/05 PAYROLL DIRECT DEP ACME CORP 1,500.00 2,493.25'),
    (10, f'10/09 CHECK 1042 {M}250.00 2,243.25'),
    (10, 'Ending Balance $2,243.25'),
    (9, 'Page 1 of 1'),
])
make('singlerun-credit.pdf', [
    (14, 'BLUE CARD Statement'),
    (10, 'Opening/Closing Date 09/04/26 - 10/03/26'),
    (10, 'New Balance $812.40   Minimum Payment Due $25.00'),
    (10, 'Payment Due Date 10/28/26'),
    (10, 'Transactions'),
    (10, '09/10 09/11 TARGET 00012345 52.18'),
    (10, '09/20 09/20 AUTOPAY PAYMENT THANK YOU -300.00'),
    (10, '09/29 09/30 NETFLIX.COM 15.49'),
    (10, 'Total fees charged in 2026 $0.00'),
])
print('ok')
