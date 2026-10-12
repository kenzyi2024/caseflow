      *================================================================*
      * VACMS HOUSEHOLD EXTRACT -- ILLUSTRATIVE LAYOUT (CaseFlow demo)  *
      * NOT the actual VaCMS interface specification, which is not     *
      * public. Models a fixed-width batch extract, one record per     *
      * SNAP case. Amounts carry 2 implied decimals (cents).           *
      *================================================================*
       01  HH-EXTRACT-REC.
           05  HH-CASE-NUMBER          PIC X(10).
           05  HH-LOCALITY-FIPS        PIC 9(3).
           05  HH-HEAD-NAME            PIC X(30).
           05  HH-SSN                  PIC 9(9).
           05  HH-DOB                  PIC 9(8).
           05  HH-APPL-DATE            PIC 9(8).
           05  HH-SIZE                 PIC 9(2).
           05  HH-ELD-DIS-IND          PIC X(1).
           05  HH-BBCE-IND             PIC X(1).
           05  HH-UNEARNED-AMT         PIC 9(5)V99.
           05  HH-UNEARNED-SRC         PIC X(4).
           05  HH-SHELTER-AMT          PIC 9(5)V99.
           05  HH-HEAT-COOL-IND        PIC X(1).
           05  HH-RESOURCES-AMT        PIC 9(7)V99.
           05  HH-LANG-CD              PIC X(2).
           05  HH-ADDRESS.
               10  HH-ADDR-LINE-1      PIC X(30).
               10  HH-ADDR-CITY        PIC X(20).
               10  HH-ADDR-STATE       PIC X(2).
               10  HH-ADDR-ZIP         PIC 9(5).
           05  FILLER                  PIC X(10).
