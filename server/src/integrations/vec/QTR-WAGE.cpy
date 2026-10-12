      *================================================================*
      * VEC QUARTERLY WAGE MATCH -- ILLUSTRATIVE LAYOUT (CaseFlow demo) *
      * NOT the actual Virginia Employment Commission interface        *
      * specification, which is not public. One record per person,    *
      * employer and quarter. Wages carry 2 implied decimals (cents).  *
      *================================================================*
       01  VEC-WAGE-REC.
           05  WG-SSN                  PIC 9(9).
           05  WG-EMPLOYEE-NAME        PIC X(30).
           05  WG-EMPLOYER-ACCT        PIC 9(10).
           05  WG-EMPLOYER-NAME        PIC X(35).
           05  WG-YEAR                 PIC 9(4).
           05  WG-QTR                  PIC 9(1).
           05  WG-WAGES-AMT            PIC 9(7)V99.
           05  FILLER                  PIC X(2).
